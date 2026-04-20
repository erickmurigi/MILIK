import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
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
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenants } from "../../redux/tenantsRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import { getChartOfAccounts } from "../../redux/apiCalls";
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

const normalizeBillingMode = (value = "combined") => {
  const normalized = String(value || "combined").trim().toLowerCase();
  if (normalized === "separate") return "combined";
  if (["rent", "utility", "combined"].includes(normalized)) return normalized;
  return "combined";
};

const getBillingModeLabel = (value = "combined") => {
  const normalized = normalizeBillingMode(value);
  if (normalized === "rent") return "Rent only";
  if (normalized === "utility") return "Utility only";
  return "Rent + Utility (creates separate invoices)";
};

const resolveBookingAmountsForMode = ({ rentAmount = 0, utilityAmount = 0, billingMode = "combined" } = {}) => {
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

const buildBookingMetadata = ({ metadata = undefined, bookingGroupId = "", billingMode = "combined" } = {}) => {
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
  if (!normalizedUtilityLabel) return undefined;

  return {
    utilityType: normalizedUtilityLabel,
    meterUtilityType: normalizedUtilityLabel,
    statementUtilityType: normalizedUtilityLabel,
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
  if (description && !/^utility\s+charge\b/i.test(description)) return description;

  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
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
  if (
    utilityLabel &&
    String(invoice?.category || "").toUpperCase() === "UTILITY_CHARGE" &&
    parsedDate &&
    !Number.isNaN(parsedDate.getTime())
  ) {
    return buildUtilityChargeDescription({
      utilityLabel,
      month: parsedDate.getMonth(),
      year: parsedDate.getFullYear(),
    });
  }

  return description;
};

const getInvoiceChargeTypeKey = ({ category, metadata = {} } = {}) => {
  const normalizedCategory = String(category || "").toUpperCase();
  if (
    normalizedCategory === "RENT_CHARGE" &&
    String(metadata?.billItemKey || "").toLowerCase() === "rent_utility:combined"
  ) {
    return "combined";
  }
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

const getActiveInvoicesForTenantPeriod = ({ invoices = [], tenantId, unitId = null, month, year }) =>
  invoices.filter((invoice) => {
    const invoiceTenantId = String(invoice?.tenant?._id || invoice?.tenant || "");
    if (invoiceTenantId !== String(tenantId || "")) return false;
    if (unitId) {
      const invoiceUnitId = String(invoice?.unit?._id || invoice?.unit || "");
      if (invoiceUnitId !== String(unitId)) return false;
    }
    if (!isActiveInvoiceStatus(invoice?.status)) return false;

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
}) => {
  const requestedBucket = getInvoiceConflictBucket({ category, metadata });
  if (!requestedBucket) return false;

  return getActiveInvoicesForTenantPeriod({ invoices, tenantId, unitId, month, year }).some((invoice) => {
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
  const sortedInvoices = [...(Array.isArray(invoices) ? invoices : [])].sort((a, b) => {
    const aTime = a?.invoiceDate ? new Date(a.invoiceDate).getTime() : new Date(a?.createdAt || 0).getTime();
    const bTime = b?.invoiceDate ? new Date(b.invoiceDate).getTime() : new Date(b?.createdAt || 0).getTime();
    return aTime - bTime;
  });

  return sortedInvoices
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

const RentalInvoices = ({ initialOpenSingleBooking = false }) => {
  const { id: tenantId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [refreshTick, setRefreshTick] = useState(0);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
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
  const currentDate = new Date();
  const currentBookingMonth = currentDate.getMonth();
  const currentBookingYear = currentDate.getFullYear();

  const [singleBookingForm, setSingleBookingForm] = useState({
    tenantId: tenantId || "",
    month: currentBookingMonth,
    year: currentBookingYear,
    dueDay: 5,
    billingMode: "combined",
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
    billingMode: "combined",
    invoiceDate: getStartOfPeriod(currentBookingMonth, currentBookingYear),
    bookWithInvoiceDate: false,
    taxHandling: "company_default",
    taxCodeKey: "vat_standard",
    taxMode: "company_default",
  });

  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null );
  const canCreateInvoice = hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "create", "propertyManagement");
  const canUpdateInvoice = hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "update", "propertyManagement");
  const canDeleteInvoice = hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "delete", "propertyManagement");
  const canExportInvoice = hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "export", "propertyManagement");
  const rawTenantsFromStore = useSelector((state) => state.tenant?.tenants);
  const propertiesFromStore = useSelector((state) => state.property?.properties || []);
  const unitsFromStore = useSelector((state) => state.unit?.units || []);
  const tenantsFromStore = useMemo(() => ensureArray(rawTenantsFromStore), [rawTenantsFromStore]);
  const [companyTaxConfig, setCompanyTaxConfig] = useState(null);

  const normalizedTaxConfig = useMemo(
    () => normalizeCompanyTaxConfig(companyTaxConfig),
    [companyTaxConfig]
  );
  const activeTaxCodes = useMemo(
    () => getActiveTaxCodes(normalizedTaxConfig),
    [normalizedTaxConfig]
  );
  const companyTaxEnabled = Boolean(normalizedTaxConfig?.taxSettings?.enabled);

  useEffect(() => {
    if (!currentCompany?._id) return;

    dispatch(getTenants({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    dispatch(getUnits({ business: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

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
    if (!currentCompany?._id) {
      setCompanyTaxConfig(null);
      return;
    }

    let isMounted = true;
    const loadCompanyTaxConfig = async () => {
      try {
        const res = await adminRequests.get(`/company-settings/${currentCompany._id}`);
        if (!isMounted) return;
        setCompanyTaxConfig(res.data || null);
        const defaultTaxCodeKey =
          res?.data?.taxSettings?.defaultTaxCodeKey || "vat_standard";
        setSingleBookingForm((prev) => ({
          ...prev,
          taxCodeKey: prev.taxCodeKey || defaultTaxCodeKey,
        }));
        setBatchBookingForm((prev) => ({
          ...prev,
          taxCodeKey: prev.taxCodeKey || defaultTaxCodeKey,
        }));
      } catch {
        if (isMounted) {
          setCompanyTaxConfig(null);
        }
      }
    };

    loadCompanyTaxConfig();
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
        const account4100 = await getChartOfAccounts({
          business: currentCompany._id,
          code: "4100",
        });

        const account4102 = await getChartOfAccounts({
          business: currentCompany._id,
          code: "4102",
        });

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


const getAssignedUnitContexts = (tenant) => {
  const rawUnits = [tenant?.unit, ...(Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits : [])]
    .filter(Boolean)
    .map((unitRef) => {
      const unitId = unitRef?._id || unitRef;
      const matchedUnit = unitsFromStore.find((unit) => String(unit?._id) === String(unitId));
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
};


const getTenantPricing = (tenant) => {
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

    const utilitiesFromUnit = context.utilityRows.reduce((sum, utility) => {
      if (utility?.isIncluded === true) return sum;
      return sum + (Number(utility?.unitCharge || utility?.amount || 0) || 0);
    }, 0);

    const billableUtilityLabels = context.utilityRows
      .filter((item) => item?.isIncluded !== true)
      .map((item) => extractUtilityLabel(item))
      .filter(Boolean);

    return {
      ...context,
      utilityAmount: utilitiesFromTenant > 0 && assignedUnitContexts.length === 1 ? utilitiesFromTenant : utilitiesFromUnit,
      utilityLabel:
        billableUtilityLabels.length === 1 ? billableUtilityLabels[0] : billableUtilityLabels.length > 1 ? "Utilities" : "",
    };
  });

  const rentAmount = unitContexts.reduce((sum, item) => sum + Number(item.rentAmount || 0), 0);
  const utilityAmount = unitContexts.reduce((sum, item) => sum + Number(item.utilityAmount || 0), 0);
  const utilityLabels = Array.from(new Set(unitContexts.map((item) => item.utilityLabel).filter(Boolean)));

  return {
    rentAmount,
    utilityAmount,
    utilityLabel: utilityLabels.length === 1 ? utilityLabels[0] : utilityLabels.length > 1 ? "Utilities" : "",
    total: rentAmount + utilityAmount,
    unitContexts,
  };
};

const getTenantPropertyId = (tenant) => {
    const directPropertyId = tenant?.property?._id || tenant?.property;
    if (directPropertyId) return directPropertyId;

    const tenantUnitId = tenant?.unit?._id || tenant?.unit;
    const matchedUnit = unitsFromStore.find(
      (unit) => String(unit?._id) === String(tenantUnitId)
    );
    return matchedUnit?.property?._id || matchedUnit?.property || null;
  };

  const activeProperties = useMemo(() => {
    return propertiesFromStore.filter((property) => {
      const propertyStatus = String(property?.status || "active").toLowerCase();
      return propertyStatus === "active";
    });
  }, [propertiesFromStore]);

  const singleBookingTenantOptions = useMemo(() => {
    return tenantsFromStore
      .filter((tenant) => String(tenant?.status || "active").toLowerCase() === "active")
      .map((tenant) => ({
        id: tenant._id,
        name: getTenantDisplayName(tenant),
        propertyName: resolveTenantPropertyName(tenant, unitsFromStore, propertiesFromStore),
        unitName: getUnitDisplayName(tenant),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tenantsFromStore, unitsFromStore, propertiesFromStore]);

  const selectedSingleBookingTenant = useMemo(() => {
    return tenantLookup[singleBookingForm.tenantId] || null;
  }, [tenantLookup, singleBookingForm.tenantId]);

  const selectedSingleBookingPreview = useMemo(() => {
    if (!selectedSingleBookingTenant) return null;
    const pricing = getTenantPricing(selectedSingleBookingTenant);
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
        return activeProperties.some(
          (property) => String(property?._id) === String(tenantPropertyId)
        );
      }

      return String(tenantPropertyId) === String(batchBookingForm.propertyId);
    });
  }, [tenantsFromStore, batchBookingForm.propertyId, activeProperties]);

  const batchBookingScopeCount = batchBookingScopeTenants.length;

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

  const companyDisplayName =
    currentCompany?.companyName ||
    currentCompany?.name ||
    currentCompany?.company ||
    "MILIK Property Management";
  const companyPhone = currentCompany?.phone || currentCompany?.phoneNumber || currentCompany?.contactPhone || "";
  const companyEmail = currentCompany?.email || currentCompany?.companyEmail || currentCompany?.contactEmail || "";
  const companyAddress = currentCompany?.address || currentCompany?.postalAddress || currentCompany?.location || "";

  const activeInvoiceSource = activeInvoice?.originalInvoice || {};
  const activeInvoiceMetadata =
    activeInvoiceSource?.metadata && typeof activeInvoiceSource.metadata === "object"
      ? activeInvoiceSource.metadata
      : {};
  const activeInvoiceTaxSnapshot =
    activeInvoiceSource?.taxSnapshot && typeof activeInvoiceSource.taxSnapshot === "object"
      ? activeInvoiceSource.taxSnapshot
      : {};
  const activeInvoiceUtilityBreakdown = Array.isArray(activeInvoiceMetadata?.utilityBreakdown)
    ? activeInvoiceMetadata.utilityBreakdown
    : [];
  const activeInvoiceNetAmount = Number(
    activeInvoiceTaxSnapshot?.netAmount ??
      activeInvoiceTaxSnapshot?.enteredAmount ??
      activeInvoiceSource?.amount ??
      activeInvoice?.amount ??
      0
  );
  const activeInvoiceTaxAmount = Number(activeInvoiceTaxSnapshot?.taxAmount || 0);
  const activeInvoiceGrossAmount = Number(
    activeInvoiceTaxSnapshot?.grossAmount ??
      activeInvoiceSource?.amount ??
      activeInvoice?.amount ??
      0
  );
  const activeInvoiceDaysOverdue = getInvoiceDaysOverdue({
    dueDate: activeInvoice?.dueDateValue || activeInvoiceSource?.dueDate || null,
    outstandingAmount: activeInvoice?.outstandingAmount,
    status: activeInvoice?.status,
  });
  const activeInvoiceSettlementPercentage =
    activeInvoiceGrossAmount > 0
      ? Math.min(
          100,
          Math.max(0, (Number(activeInvoice?.appliedAmount || 0) / activeInvoiceGrossAmount) * 100)
        )
      : 0;
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

  const toggleRowSelection = (rowKey) => {
    setSelectedInvoices((prev) => {
      const hasRow = prev.includes(rowKey);
      if (hasRow) return prev.filter((id) => id !== rowKey);
      return [...prev, rowKey];
    });
  };

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

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(invoice?.id || "Invoice")}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Inter, Arial, sans-serif; margin: 0; color: #0f172a; background: #f8fafc; }
    .page { background: #ffffff; border: 1px solid #dbe4ee; border-radius: 18px; padding: 28px; }
    .header { display:flex; justify-content:space-between; gap:24px; border-bottom: 3px solid #0B3B2E; padding-bottom: 18px; margin-bottom: 18px; }
    .brand-wrap { display:flex; gap:14px; align-items:flex-start; }
    .logo { width:54px; height:54px; border-radius:16px; background:#0B3B2E; color:#fff; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:800; }
    .brand { font-size: 24px; font-weight: 800; color: #0B3B2E; letter-spacing: 0.01em; }
    .subbrand { margin-top:4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: #64748b; font-weight: 700; }
    .company { margin-top:8px; font-size: 13px; color:#0f172a; line-height:1.6; }
    .invoice-meta { min-width: 260px; background:#f8fafc; border:1px solid #dbe4ee; border-radius:16px; padding:14px 16px; }
    .invoice-meta h2 { margin:0 0 10px 0; color:#0B3B2E; font-size: 18px; }
    .meta-grid { display:grid; grid-template-columns: 110px 1fr; gap:8px 10px; font-size: 12px; }
    .label { color:#64748b; font-weight:700; }
    .value { color:#0f172a; font-weight:700; }
    .section-grid { display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom: 18px; }
    .panel { border:1px solid #dbe4ee; border-radius:16px; padding:14px 16px; }
    .panel h3 { margin:0 0 10px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; color:#64748b; }
    .panel .name { font-size:15px; font-weight:800; color:#0f172a; margin-bottom:6px; }
    .panel .small { font-size: 12px; color:#334155; line-height:1.6; }
    table { width:100%; border-collapse:collapse; }
    th, td { border:1px solid #dbe4ee; padding:10px 12px; font-size:12px; vertical-align:top; }
    th { background:#0B3B2E; color:#ffffff; text-align:left; font-weight:800; }
    td.num { text-align:right; font-weight:700; }
    .totals { width: 320px; margin-left:auto; margin-top: 14px; border-collapse: separate; border-spacing: 0; }
    .totals td { border:1px solid #dbe4ee; padding:10px 12px; font-size:12px; }
    .totals .label-cell { background:#f8fafc; font-weight:700; color:#475569; }
    .totals .value-cell { text-align:right; font-weight:800; color:#0f172a; }
    .totals .grand .label-cell, .totals .grand .value-cell { background:#ecfdf3; color:#0B3B2E; font-size:14px; }
    .footer { margin-top:22px; display:grid; grid-template-columns: 1.2fr .8fr; gap:16px; }
    .note-box, .signature-box { border:1px solid #dbe4ee; border-radius:16px; padding:14px 16px; min-height:110px; }
    .note-box h4, .signature-box h4 { margin:0 0 10px 0; font-size:12px; text-transform:uppercase; letter-spacing:0.14em; color:#64748b; }
    .note-box p, .signature-box p { margin:0; font-size:12px; color:#334155; line-height:1.7; }
    .signature-line { margin-top: 34px; border-top: 1px solid #94a3b8; padding-top: 8px; font-size: 11px; color:#475569; }
    .watermark { margin-top: 16px; text-align:center; font-size:10px; color:#94a3b8; letter-spacing:0.12em; text-transform:uppercase; }
    @media print {
      body { background:#ffffff; }
      .page { border:none; border-radius:0; padding:0; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="brand-wrap">
        <div class="logo">M</div>
        <div>
          <div class="brand">${escapeHtml(companyDisplayName)}</div>
          <div class="subbrand">Official Tenant Invoice</div>
          <div class="company">
            ${companyAddress ? `${escapeHtml(companyAddress)}<br/>` : ""}
            ${companyPhone ? `Phone: ${escapeHtml(companyPhone)}<br/>` : ""}
            ${companyEmail ? `Email: ${escapeHtml(companyEmail)}` : ""}
          </div>
        </div>
      </div>
      <div class="invoice-meta">
        <h2>Invoice</h2>
        <div class="meta-grid">
          <div class="label">Invoice #</div><div class="value">${escapeHtml(invoice?.id)}</div>
          <div class="label">Booking / Invoice Date</div><div class="value">${escapeHtml(invoiceDateLabel)}</div>
          <div class="label">Due Date</div><div class="value">${escapeHtml(dueDateLabel)}</div>
          <div class="label">Inv Desc</div><div class="value">${escapeHtml(invoice?.invoiceDescription || deriveInvoiceDescription(sourceInvoice) || invoice?.period || "-")}</div>
          <div class="label">Bill Type</div><div class="value">${escapeHtml(chargeTypeLabel)}</div>
          <div class="label">Status</div><div class="value">${escapeHtml(invoice?.status || "Issued")}</div>
          <div class="label">Prepared On</div><div class="value">${escapeHtml(preparedLabel)}</div>
        </div>
      </div>
    </div>

    <div class="section-grid">
      <div class="panel">
        <h3>Bill To</h3>
        <div class="name">${escapeHtml(invoice?.tenantName || "Tenant")}</div>
        <div class="small">
          Property: ${escapeHtml(invoice?.propertyName || "-")}<br/>
          Unit: ${escapeHtml(invoice?.unitName || "-")}
        </div>
      </div>
      <div class="panel">
        <h3>Invoice Summary</h3>
        <div class="small">
          ${escapeHtml(invoice?.invoiceDescription || deriveInvoiceDescription(sourceInvoice) || `${chargeTypeLabel} charge`)}<br/>
          ${hasTaxClassification ? `Tax code: ${escapeHtml(taxSnapshot?.taxCodeName || "Tax")} (${Number(taxSnapshot?.taxRate || 0)}%)` : "No tax applied to this invoice."}
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:64px;">#</th>
          <th>Description</th>
          <th style="width:180px; text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>

    <table class="totals">
      <tbody>
        <tr>
          <td class="label-cell">Subtotal</td>
          <td class="value-cell">KES ${subtotal.toLocaleString()}</td>
        </tr>
        <tr>
          <td class="label-cell">Tax</td>
          <td class="value-cell">KES ${taxAmount.toLocaleString()}</td>
        </tr>
        <tr class="grand">
          <td class="label-cell">Total Due</td>
          <td class="value-cell">KES ${totalAmount.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      <div class="note-box">
        <h4>Notes</h4>
        <p>
          This invoice was generated from the MILIK invoicing workflow. Please settle the amount due by the stated due date to avoid late-penalty processing where applicable.
        </p>
      </div>
      <div class="signature-box">
        <h4>Authorised By</h4>
        <p>${escapeHtml(companyDisplayName)}</p>
        <div class="signature-line">Authorised signature</div>
      </div>
    </div>

    <div class="watermark">Milik Property Management System</div>
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
    .logo { width:74px; height:74px; border-radius:16px; background:#0B3B2E; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:30px; border:1px solid #cbd5e1; }
    h1 { margin: 0; color: #0B3B2E; font-size: 22px; }
    .company { margin-top:4px; color:#111827; font-size:13px; font-weight:700; }
    .meta { margin: 0; color: #4b5563; font-size: 12px; text-align:right; line-height:1.6; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; }
    th { background: #0B3B2E; color: white; text-align: left; }
    tfoot td { font-weight: 700; background: #f3f4f6; }
    @media print { body { margin: 8mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand-wrap">
      <div class="logo">M</div>
      <div>
        <h1>Tenant Invoices Register</h1>
        <div class="company">${escapeHtml(companyDisplayName)}</div>
      </div>
    </div>
    <div class="meta">Generated: ${escapeHtml(formatDateTimeDisplay(new Date()))}<br/>Count: ${rows.length}<br/>Total: KES ${total.toLocaleString()}</div>
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

  const handleViewInvoice = (invoice) => {
    if (!invoice) return;
    setActiveInvoice(invoice);
    setInvoiceDetailOpen(true);
  };

  const handlePrintInvoice = (invoice) => {
    if (!canExportInvoice) {
      toast.warning("You do not have permission to print invoices");
      return;
    }
    if (!invoice) return;
    const printWindow = openHtmlDocument(`Invoice ${invoice.id}`, buildInvoiceHtml(invoice));
    if (!printWindow) return;

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  };

  const handleDownloadInvoice = (invoice) => {
    if (!canExportInvoice) {
      toast.warning("You do not have permission to download invoices");
      return;
    }
    if (!invoice) return;
    const html = buildInvoiceHtml(invoice);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${invoice.id || "invoice"}_${(invoice.period || "period").replace(/\s+/g, "_")}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    toast.success(`Downloaded ${invoice.id}`);
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

  const resolvedBillingPeriodDate =
    targetTenant?.invoiceDateOverride || getStartOfPeriod(month, year);
  const resolvedBookingDate =
    bookingDateOverride ||
    targetTenant?.bookingDateOverride ||
    resolvedBillingPeriodDate;
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
    dueDate: getDueDateForPeriod(month, year, dueDay),
    createdBy,
    chartAccountId: revenueAccountId,
    metadata: buildBookingMetadata({
      metadata:
        metadata && typeof metadata === "object"
          ? {
              ...metadata,
              ...(bookingDateOverride ? { bookWithBookingDate: true } : {}),
            }
          : bookingDateOverride
          ? { bookWithBookingDate: true }
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

  console.log("Creating invoice with payload:", invoicePayload);

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

  if (!unitContexts.length) {
    return { created: false, reason: "No assigned unit was found for this tenant" };
  }

  for (const unitContext of unitContexts) {
    const bookingAmounts = resolveBookingAmountsForMode({
      rentAmount: unitContext.rentAmount,
      utilityAmount: unitContext.utilityAmount,
      billingMode: normalizedBillingMode,
    });
    const rentAmount = Number(bookingAmounts.rentAmount || 0);
    const utilityAmount = Number(bookingAmounts.utilityAmount || 0);
    const utilityMetadata = buildUtilityInvoiceMetadata(unitContext.utilityLabel);
    const targetTenantForUnit = {
      ...targetTenant,
      invoiceUnit: unitContext.unit,
      bookingDateOverride: bookingDateOverride || getStartOfPeriod(month, year),
      invoiceDateOverride: getStartOfPeriod(month, year),
    };

    if (rentAmount <= 0 && utilityAmount <= 0) {
      continue;
    }

    const rentBlocked =
      rentAmount > 0 &&
      hasBlockingInvoiceForRequest({
        invoices: tenantInvoicesFromApi,
        tenantId: targetTenant._id,
        unitId: unitContext.unitId,
        month,
        year,
        category: "RENT_CHARGE",
      });

    const utilityBlocked =
      utilityAmount > 0 &&
      hasBlockingInvoiceForRequest({
        invoices: tenantInvoicesFromApi,
        tenantId: targetTenant._id,
        unitId: unitContext.unitId,
        month,
        year,
        category: "UTILITY_CHARGE",
        metadata: utilityMetadata,
      });

    if (rentBlocked || utilityBlocked) {
      encounteredBlockingInvoice = true;
    }

    if (rentAmount > 0 && !rentBlocked) {
      const createdInvoice = await createBackendInvoiceEntry({
        targetTenant: targetTenantForUnit,
        amount: rentAmount,
        paymentType: "rent",
        month,
        year,
        dueDay,
        description: buildRecurringInvoiceDescription({ month, year, label: `Rent - ${unitContext.unitName}` }),
        taxSelection,
        bookingDateOverride,
        bookingGroupId: effectiveBookingGroupId,
        billingMode: normalizedBillingMode,
      });
      createdInvoiceIds.push(createdInvoice?.invoiceNumber || "AUTO");
    }

    if (utilityAmount > 0 && !utilityBlocked) {
      const createdInvoice = await createBackendInvoiceEntry({
        targetTenant: targetTenantForUnit,
        amount: utilityAmount,
        paymentType: "utility",
        month,
        year,
        dueDay,
        description: buildUtilityChargeDescription({ utilityLabel: unitContext.utilityLabel || `Utility - ${unitContext.unitName}`, month, year }),
        metadata: utilityMetadata,
        taxSelection,
        bookingDateOverride,
        bookingGroupId: effectiveBookingGroupId,
        billingMode: normalizedBillingMode,
      });
      createdInvoiceIds.push(createdInvoice?.invoiceNumber || "AUTO");
    }
  }

  if (createdInvoiceIds.length === 0 && encounteredBlockingInvoice) {
    return { created: false, reason: "already_exists", periodLabel };
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

    const pricing = getTenantPricing(selectedTenant);
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
          const bookingAmounts = resolveBookingAmountsForMode({
            rentAmount: unitContext.rentAmount,
            utilityAmount: unitContext.utilityAmount,
            billingMode: normalizedBatchBillingMode,
          });
          const rentAmount = Number(bookingAmounts.rentAmount || 0);
          const utilityAmount = Number(bookingAmounts.utilityAmount || 0);
          const utilityMetadata = buildUtilityInvoiceMetadata(unitContext.utilityLabel);
          const targetTenantForUnit = {
            ...tenant,
            invoiceUnit: unitContext.unit,
            bookingDateOverride: batchBookingDateOverride || getStartOfPeriod(month, year),
            invoiceDateOverride: getStartOfPeriod(month, year),
          };

          if (rentAmount <= 0 && utilityAmount <= 0) {
            continue;
          }

          const shouldCreateRent =
            rentAmount > 0 &&
            !hasBlockingInvoiceForRequest({
              invoices: tenantInvoicesFromApi,
              tenantId: tenant._id,
              unitId: unitContext.unitId,
              month,
              year,
              category: "RENT_CHARGE",
            });

          const shouldCreateUtility =
            utilityAmount > 0 &&
            !hasBlockingInvoiceForRequest({
              invoices: tenantInvoicesFromApi,
              tenantId: tenant._id,
              unitId: unitContext.unitId,
              month,
              year,
              category: "UTILITY_CHARGE",
              metadata: utilityMetadata,
            });

          if (shouldCreateRent) {
            batchItems.push(
              buildInvoicePayloadForTenant({
                targetTenant: targetTenantForUnit,
                amount: rentAmount,
                paymentType: "rent",
                month,
                year,
                dueDay,
                description: buildRecurringInvoiceDescription({ month, year, label: `Rent - ${unitContext.unitName}` }),
                taxSelection: selectedTaxSelection,
                bookingDateOverride: batchBookingDateOverride,
                bookingGroupId: batchBookingGroupId,
                billingMode: normalizedBatchBillingMode,
              })
            );
            tenantHasBatchItems = true;
          }

          if (shouldCreateUtility) {
            batchItems.push(
              buildInvoicePayloadForTenant({
                targetTenant: targetTenantForUnit,
                amount: utilityAmount,
                paymentType: "utility",
                month,
                year,
                dueDay,
                description: buildUtilityChargeDescription({ utilityLabel: unitContext.utilityLabel || `Utility - ${unitContext.unitName}`, month, year }),
                metadata: utilityMetadata,
                taxSelection: selectedTaxSelection,
                bookingDateOverride: batchBookingDateOverride,
                bookingGroupId: batchBookingGroupId,
                billingMode: normalizedBatchBillingMode,
              })
            );
            tenantHasBatchItems = true;
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

      const batchResponse = await createTenantInvoicesBatch({
        business:
          batchItems[0]?.business ||
          currentCompany?._id ||
          currentUser?.company?._id ||
          currentUser?.company,
        items: batchItems,
      });

      const successfulRows = Array.isArray(batchResponse?.results)
        ? batchResponse.results.filter((row) => row?.success)
        : [];
      const failedRows = Array.isArray(batchResponse?.results)
        ? batchResponse.results.filter((row) => !row?.success)
        : [];

      createdCount = new Set(successfulRows.map((row) => String(row?.tenant || "")).filter(Boolean)).size;
      const failedCount = new Set(failedRows.map((row) => String(row?.tenant || "")).filter(Boolean)).size;

      if (createdCount === 0 && failedRows.length > 0) {
        const primaryError =
          failedRows.find((row) => String(row?.error || "").trim())?.error ||
          batchResponse?.message ||
          "Batch booking failed";

        console.warn("Batch booking returned zero created rows. Falling back to legacy booking.", {
          summary: batchResponse?.summary,
          firstErrors: failedRows.slice(0, 5),
        });

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

        console.warn("Batch booking request failed with structured response. Falling back to legacy booking.", {
          summary: batchData?.summary,
          firstErrors: failedRows.slice(0, 5),
        });

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

    try {
      for (const invoice of selectedRows) {
        if (!invoice?._id) continue;
        await deleteTenantInvoice(invoice._id);
      }

      toast.success(`${selectedRows.length} invoice(s) deleted successfully`);
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
      setSelectedInvoices([]);
      setSelectAll(false);
      setDeletingInvoiceIds([]);
    } catch (error) {
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
    }
  };

  const handleViewTenantStatement = (targetTenantId) => {
    navigate(`/tenant/${targetTenantId}/statement`);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-3">
        <div className="mx-auto flex w-full max-w-[96%] min-h-0 flex-1 flex-col gap-3">
          <div className="flex-shrink-0 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              {tenantId ? (
                <button
                  onClick={() => navigate("/tenants")}
                  className="flex items-center gap-2 text-xs font-semibold text-gray-600 hover:text-gray-900"
                  title="Back to Tenants"
                >
                  <FaArrowLeft size={12} />
                  Back to tenant list
                </button>
              ) : (
                <div />
              )}
            </div>

            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
              <div className="rounded border border-blue-200 bg-blue-50 p-2.5">
                <p className="text-[11px] font-semibold text-blue-600">Total Invoices</p>
                <p className="text-xl font-bold leading-tight text-blue-900">{totalFilteredCount}</p>
              </div>
              <div className="rounded border border-green-200 bg-green-50 p-2.5">
                <p className="text-[11px] font-semibold text-green-600">Page Total</p>
                <p className="text-xl font-bold leading-tight text-green-900">
                  KES {totalAmount.toLocaleString()}
                </p>
              </div>
              <div className="rounded border border-orange-200 bg-orange-50 p-2.5">
                <p className="text-[11px] font-semibold text-orange-600">Page Pending</p>
                <p className="text-xl font-bold leading-tight text-orange-900">
                  KES {pendingAmount.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setDraftFilters((prev) => ({ ...prev, status: "ACTIVE" }))}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    draftFilters.status === "ACTIVE"
                      ? `${MILIK_GREEN} text-white`
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Issued + Paid
                </button>
                <button
                  onClick={() => setDraftFilters((prev) => ({ ...prev, status: "Issued" }))}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    draftFilters.status === "Issued"
                      ? `${MILIK_GREEN} text-white`
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Issued
                </button>
                <button
                  onClick={() => setDraftFilters((prev) => ({ ...prev, status: "Paid" }))}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    draftFilters.status === "Paid"
                      ? `${MILIK_GREEN} text-white`
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  Paid
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={draftFilters.invoiceNo}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, invoiceNo: e.target.value }))}
                  placeholder="Invoice #"
                  className="rounded border border-gray-300 px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />

                {!tenantId && (
                  <input
                    type="text"
                    value={draftFilters.tenantName}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, tenantName: e.target.value }))}
                    placeholder="Tenant name"
                    className="rounded border border-gray-300 px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  />
                )}

                <select
                  value={draftFilters.property}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      property: e.target.value,
                      unit: "any",
                    }))
                  }
                  className="rounded border border-gray-300 bg-[#DDEFE1] px-3 py-1 text-xs text-gray-800 shadow-sm"
                >
                  {uniqueProperties.map((property) => (
                    <option key={property} value={property}>
                      {property === "any" ? "Property" : property}
                    </option>
                  ))}
                </select>

                <select
                  value={draftFilters.unit}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, unit: e.target.value }))}
                  className="rounded border border-gray-300 bg-[#DDEFE1] px-3 py-1 text-xs text-gray-800 shadow-sm"
                >
                  {unitsForSelectedProperty.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit === "any" ? "Unit" : unit}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={draftFilters.fromDate}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
                  className="rounded border border-gray-300 px-3 py-1 text-xs shadow-sm"
                  title="From date"
                />

                <input
                  type="date"
                  value={draftFilters.toDate}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, toDate: e.target.value }))}
                  className="rounded border border-gray-300 px-3 py-1 text-xs shadow-sm"
                  title="To date"
                />

                <button
                  onClick={applySearch}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                >
                  <FaSearch className="text-xs" />
                  Search
                </button>

                <button
                  onClick={resetFilters}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                >
                  <FaRedoAlt className="text-xs" />
                  Reset
                </button>

                <button
                  onClick={handleEditSelected}
                  disabled={!canUpdateInvoice || !canEdit}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${
                    canEdit ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  <FaEdit className="text-xs" />
                  Edit
                </button>

                <button
                  onClick={handleDeleteSelected}
                  disabled={!canDeleteInvoice || selectedCount === 0}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${
                    selectedCount > 0 ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  <FaTrash className="text-xs" />
                  Delete
                </button>

                <button
                  onClick={handlePrintList}
                  disabled={!canExportInvoice || totalFilteredCount === 0}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${
                    totalFilteredCount > 0
                      ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`
                      : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  <FaPrint className="text-xs" />
                  Print List
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate("/tenants/deposits")}
                    disabled={!canCreateInvoice}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold text-white ${canCreateInvoice ? `${MILIK_GREEN} ${MILIK_GREEN_HOVER}` : "bg-gray-400 cursor-not-allowed"}`}
                  >
                    Book Deposit
                  </button>
                  <div className="flex items-center gap-1">
                    <FaPlus className="text-[10px] text-[#0B3B2E]" />
                    <select
                      value={bookingAction}
                      disabled={!canCreateInvoice}
                      onChange={(e) => handleBookingActionChange(e.target.value)}
                      className="rounded-lg border border-[#0B3B2E] bg-[#E7F5EC] px-3 py-1 text-xs font-semibold text-[#0B3B2E] shadow-sm"
                    >
                      <option value="">Booking</option>
                      <option value="single">Create Single Booking</option>
                      <option value="batch">Create Batch Booking</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[1320px] text-xs">
                <thead>
                  <tr className={`${MILIK_GREEN} sticky top-0 z-10 text-white`}>
                    <th className="px-3 py-2 text-left">
                      <input type="checkbox" checked={currentPageInvoices.length > 0 && selectAll} onChange={toggleSelectAll} />
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">Invoice #</th>
                    {!tenantId && <th className="px-3 py-2 text-left font-semibold">Tenant</th>}
                    {!tenantId && <th className="px-3 py-2 text-left font-semibold">Property</th>}
                    <th className="px-3 py-2 text-left font-semibold">Unit</th>
                    <th className="px-3 py-2 text-left font-semibold">Inv Desc</th>
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    <th className="px-3 py-2 text-center font-semibold">Booking / Invoice Date</th>
                    <th className="px-3 py-2 text-center font-semibold">Due Date</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-center font-semibold">Status</th>
                    <th className="px-3 py-2 text-center font-semibold">Created</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {totalFilteredCount === 0 ? (
                    <tr>
                      <td colSpan={tenantId ? "12" : "14"} className="px-4 py-8 text-center text-gray-500">
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
                    currentPageInvoices.map((invoice, idx) => { const isSelected = selectedInvoices.includes(invoice.key); return (
                      <tr
                        key={invoice.key}
                        className={`cursor-pointer border-b border-slate-200 transition-colors ${
                          isSelected
                            ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                            : idx % 2 === 0
                            ? "bg-white hover:bg-blue-50/40"
                            : "bg-slate-50 hover:bg-blue-50/40"
                        }`}
                        onClick={() => handleViewInvoice(invoice)}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelection(invoice.key)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2 font-bold text-blue-700">{invoice.id}</td>
                        {!tenantId && (
                          <td className="px-3 py-2 font-bold text-slate-900">{invoice.tenantName}</td>
                        )}
                        {!tenantId && (
                          <td className="px-3 py-2 font-semibold text-slate-900">{invoice.propertyName}</td>
                        )}
                        <td className="px-3 py-2 font-semibold text-slate-900">{invoice.unitName}</td>
                        <td className="px-3 py-2 font-semibold text-orange-700">{invoice.invoiceDescription || invoice.period}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                            {invoice.chargeTypeLabel || getInvoiceChargeTypeLabel(invoice.chargeType)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-700">{invoice.invoiceDateLabel}</td>
                        <td className="px-3 py-2 text-center text-gray-700">{invoice.dueDateLabel}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">
                          KES {Number(invoice.amount || 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-flex rounded px-2 py-0.5 text-[10px] font-semibold ${
                              invoice.status === "Paid"
                                ? "bg-green-100 text-green-700"
                                : invoice.status === "Cancelled" || invoice.status === "Reversed"
                                ? "bg-slate-100 text-slate-700"
                                : "bg-orange-100 text-orange-700"
                            }`}
                          >
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-600">{invoice.createdDate}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleViewInvoice(invoice)}
                              className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
                              title="View Invoice"
                            >
                              <FaEye size={12} />
                            </button>
                            <button
                              onClick={() => handlePrintInvoice(invoice)}
                              disabled={!canExportInvoice}
                              className="rounded p-1 text-purple-600 hover:bg-purple-50 hover:text-purple-800 disabled:cursor-not-allowed disabled:opacity-40"
                              title={canExportInvoice ? "Print Invoice" : "You do not have permission to print invoices"}
                            >
                              <FaPrint size={12} />
                            </button>
                            <button
                              onClick={() => handleDownloadInvoice(invoice)}
                              disabled={!canExportInvoice}
                              className="rounded p-1 text-green-600 hover:bg-green-50 hover:text-green-800 disabled:cursor-not-allowed disabled:opacity-40"
                              title={canExportInvoice ? "Download Invoice" : "You do not have permission to download invoices"}
                            >
                              <FaDownload size={12} />
                            </button>
                            <button
                              onClick={() => handleDeleteSingle(invoice)}
                              disabled={!canDeleteInvoice}
                              className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                              title={canDeleteInvoice ? "Delete Invoice" : "You do not have permission to delete invoices"}
                            >
                              <FaTrash size={12} />
                            </button>
                            {!tenantId && (
                              <button
                                onClick={() => handleViewTenantStatement(invoice.tenantId)}
                                className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
                                title="View Tenant Statement"
                              >
                                <FaArrowRight size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ); })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span> {totalFilteredCount === 0 ? 0 : startIndex + 1}
                {" - "}
                {endIndex} of {totalFilteredCount} invoice(s)
                {appliedFilters.status !== "ACTIVE" && ` · Status: ${appliedFilters.status}`}
              </p>
              <p>
                <span className="font-semibold">Selected:</span> {selectedCount}
                {totalFilteredCount > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold">Total:</span> KES {totalAmount.toLocaleString()}
                  </>
                )}
              </p>
            </div>

<div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
  <p>
    <span className="font-semibold">Per page:</span> {ITEMS_PER_PAGE}
  </p>
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
      disabled={safeCurrentPage === 1}
      className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Previous
    </button>
    <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
      Page {safeCurrentPage} of {totalPages}
    </span>
    <button
      type="button"
      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
      disabled={safeCurrentPage === totalPages}
      className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Next
    </button>
  </div>
</div>
          </div>
        </div>
      </div>

      {showSingleBooking && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:items-center sm:p-6">
          <div className="flex w-full max-w-xl max-h-[calc(100vh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className="sticky top-0 z-20 flex items-center justify-between bg-[#0B3B2E] px-5 py-3 text-white">
              <h3 className="text-sm font-bold tracking-wide">Single Tenant Booking</h3>
              <button
                onClick={() => {
                  setShowSingleBooking(false);
                  setBookingAction("");
                }}
                className="text-xs font-semibold px-2 py-1 rounded bg-white/20 hover:bg-white/30"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tenant</label>
                  <select
                    value={singleBookingForm.tenantId}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, tenantId: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  >
                    <option value="">Select tenant</option>
                    {singleBookingTenantOptions.map((tenantOption) => (
                      <option key={tenantOption.id} value={tenantOption.id}>
                        {tenantOption.name} - {tenantOption.propertyName} ({tenantOption.unitName})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Period</label>
                  <select
                    value={singleBookingForm.month}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => {
                        const nextPeriod = clampBillingPeriod(Number(e.target.value), prev.year);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    {MONTH_OPTIONS.map((monthOption) => (
                      <option
                        key={monthOption.value}
                        value={monthOption.value}
                        disabled={isFutureBillingPeriod(monthOption.value, Number(singleBookingForm.year))}
                      >
                        {monthOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Year</label>
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
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>


                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Booking Date</label>
                  <input
                    type="date"
                    value={singleBookingForm.invoiceDate ? new Date(singleBookingForm.invoiceDate).toISOString().slice(0, 10) : ""}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, invoiceDate: e.target.value ? new Date(e.target.value) : prev.invoiceDate, bookWithInvoiceDate: true }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Due Day</label>
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
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Booking Option</label>
                  <select
                    value={singleBookingForm.billingMode}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, billingMode: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="combined">Rent + Utility</option>
                    <option value="rent">Rent only</option>
                    <option value="utility">Utility only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Handling</label>
                  <select
                    value={singleBookingForm.taxHandling}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, taxHandling: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="company_default">Use company default</option>
                    <option value="taxable" disabled={!companyTaxEnabled}>Force taxable</option>
                    <option value="non_taxable">Force non-taxable</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Code</label>
                  <select
                    value={singleBookingForm.taxCodeKey}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, taxCodeKey: e.target.value }))
                    }
                    disabled={singleBookingForm.taxHandling === "non_taxable"}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    {activeTaxCodes.map((code) => (
                      <option key={code.key} value={code.key}>
                        {code.name} ({Number(code.rate || 0)}%)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Mode</label>
                  <select
                    value={singleBookingForm.taxMode}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, taxMode: e.target.value }))
                    }
                    disabled={singleBookingForm.taxHandling === "non_taxable"}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    <option value="company_default">Use company default</option>
                    <option value="exclusive">Exclusive</option>
                    <option value="inclusive">Inclusive</option>
                  </select>
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

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowSingleBooking(false);
                    setBookingAction("");
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSingleBooking}
                  disabled={submittingSingleBooking}
                  className="px-4 py-2 text-xs font-semibold rounded-lg text-white bg-[#0B3B2E] hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingSingleBooking ? "Creating..." : "Create Booking"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBatchBooking && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:items-center sm:p-6">
          <div className="flex w-full max-w-xl max-h-[calc(100vh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className="sticky top-0 z-20 flex items-center justify-between bg-[#0B3B2E] px-5 py-3 text-white">
              <h3 className="text-sm font-bold tracking-wide">Batch Booking</h3>
              <button
                onClick={() => {
                  setShowBatchBooking(false);
                  setBookingAction("");
                }}
                className="text-xs font-semibold px-2 py-1 rounded bg-white/20 hover:bg-white/30"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Property Scope (Optional)
                  </label>
                  <select
                    value={batchBookingForm.propertyId}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, propertyId: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="all">All active properties</option>
                    {activeProperties.map((property) => (
                      <option key={property._id} value={property._id}>
                        {property.propertyName || property.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Period</label>
                  <select
                    value={batchBookingForm.month}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => {
                        const nextPeriod = clampBillingPeriod(Number(e.target.value), prev.year);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    {MONTH_OPTIONS.map((monthOption) => (
                      <option
                        key={monthOption.value}
                        value={monthOption.value}
                        disabled={isFutureBillingPeriod(monthOption.value, Number(batchBookingForm.year))}
                      >
                        {monthOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Year</label>
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
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Booking Date</label>
                  <input
                    type="date"
                    value={batchBookingForm.invoiceDate ? new Date(batchBookingForm.invoiceDate).toISOString().slice(0, 10) : ""}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, invoiceDate: e.target.value ? new Date(e.target.value) : prev.invoiceDate, bookWithInvoiceDate: true }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Due Day</label>
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
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Booking Option</label>
                  <select
                    value={batchBookingForm.billingMode}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, billingMode: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="combined">Rent + Utility</option>
                    <option value="rent">Rent only</option>
                    <option value="utility">Utility only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Handling</label>
                  <select
                    value={batchBookingForm.taxHandling}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, taxHandling: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="company_default">Use company default</option>
                    <option value="taxable" disabled={!companyTaxEnabled}>Force taxable</option>
                    <option value="non_taxable">Force non-taxable</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Code</label>
                  <select
                    value={batchBookingForm.taxCodeKey}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, taxCodeKey: e.target.value }))
                    }
                    disabled={batchBookingForm.taxHandling === "non_taxable"}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    {activeTaxCodes.map((code) => (
                      <option key={code.key} value={code.key}>
                        {code.name} ({Number(code.rate || 0)}%)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Mode</label>
                  <select
                    value={batchBookingForm.taxMode}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, taxMode: e.target.value }))
                    }
                    disabled={batchBookingForm.taxHandling === "non_taxable"}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    <option value="company_default">Use company default</option>
                    <option value="exclusive">Exclusive</option>
                    <option value="inclusive">Inclusive</option>
                  </select>
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

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowBatchBooking(false);
                    setBookingAction("");
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBatchBooking}
                  disabled={submittingBatchBooking}
                  className="px-4 py-2 text-xs font-semibold rounded-lg text-white bg-[#0B3B2E] hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingBatchBooking ? "Running..." : "Run Batch Booking"}
                </button>
              </div>
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
              className="relative flex h-full w-full max-w-[760px] flex-col border-l border-slate-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114D3C] to-[#0B3B2E] px-5 py-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white">
                        <FaReceipt size={16} />
                      </span>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-100">
                          Invoice Details
                        </p>
                        <h3 className="truncate text-lg font-bold">
                          {activeInvoice.id}
                        </h3>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${getInvoiceStatusBadgeClasses(
                          activeInvoice.status
                        )} bg-white/95`}
                      >
                        {activeInvoice.status}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white/95">
                      {activeInvoice.invoiceDescription || activeInvoice.period}
                    </p>
                    <p className="mt-1 text-xs text-emerald-100">
                      {activeInvoice.tenantName} · {activeInvoice.propertyName} · {activeInvoice.unitName}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={closeInvoiceDetail}
                    className="rounded-xl border border-white/15 bg-white/10 p-2 text-white transition hover:bg-white/20"
                    title="Close"
                  >
                    <FaTimes size={14} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
                <button
                  type="button"
                  onClick={() => handlePrintInvoice(activeInvoice)}
                  disabled={!canExportInvoice}
                  className="inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs font-semibold text-purple-700 transition hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaPrint size={12} />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadInvoice(activeInvoice)}
                  disabled={!canExportInvoice}
                  className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-white px-3 py-2 text-xs font-semibold text-green-700 transition hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaDownload size={12} />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => handleViewTenantStatement(activeInvoice.tenantId)}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                >
                  <FaArrowRight size={12} />
                  Tenant Statement
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSingle(activeInvoice)}
                  disabled={!canDeleteActiveInvoice}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    canDeleteActiveInvoice
                      ? "Delete invoice"
                      : canDeleteInvoice
                      ? "Paid invoices cannot be deleted from this screen"
                      : "You do not have permission to delete invoices"
                  }
                >
                  <FaTrash size={12} />
                  Delete
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 px-5 py-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                      Gross Amount
                    </p>
                    <p className="mt-2 text-xl font-bold text-slate-900">
                      {formatCurrency(activeInvoiceGrossAmount)}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">Booked invoice total</p>
                  </div>

                  <div className="rounded-2xl border border-green-200 bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-green-600">
                      Applied
                    </p>
                    <p className="mt-2 text-xl font-bold text-slate-900">
                      {formatCurrency(activeInvoice?.appliedAmount || 0)}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Settlement progress {activeInvoiceSettlementPercentage.toFixed(0)}%
                    </p>
                  </div>

                  <div className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-600">
                      Outstanding
                    </p>
                    <p className="mt-2 text-xl font-bold text-slate-900">
                      {formatCurrency(activeInvoice?.outstandingAmount || 0)}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">Remaining to settle</p>
                  </div>

                  <div className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">
                      Due Pressure
                    </p>
                    <p className="mt-2 text-xl font-bold text-slate-900">
                      {activeInvoiceDaysOverdue > 0 ? `${activeInvoiceDaysOverdue} day(s)` : "On time"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Based on due date and open balance
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Settlement Progress</h4>
                      <p className="text-xs text-slate-500">
                        Quick visual on how much of this invoice has already been cleared.
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {activeInvoiceSettlementPercentage.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[#0B3B2E] transition-all"
                      style={{ width: `${activeInvoiceSettlementPercentage}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr,0.85fr]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2">
                        <FaMoneyBillWave className="text-slate-500" size={14} />
                        <h4 className="text-sm font-bold text-slate-900">Amount Breakdown</h4>
                      </div>
                      <div className="space-y-2">
                        {activeInvoiceBreakdown.map((item, index) => (
                          <div
                            key={`${item.label}-${index}`}
                            className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
                          >
                            <p className="text-xs font-semibold text-slate-700">{item.label}</p>
                            <p className="text-xs font-bold text-slate-900">{formatCurrency(item.amount)}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                          <p className="font-semibold uppercase tracking-wide text-slate-400">Net</p>
                          <p className="mt-1 font-bold text-slate-900">{formatCurrency(activeInvoiceNetAmount)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                          <p className="font-semibold uppercase tracking-wide text-slate-400">Tax</p>
                          <p className="mt-1 font-bold text-slate-900">{formatCurrency(activeInvoiceTaxAmount)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                          <p className="font-semibold uppercase tracking-wide text-slate-400">Gross</p>
                          <p className="mt-1 font-bold text-slate-900">{formatCurrency(activeInvoiceGrossAmount)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2">
                        <FaFileInvoice className="text-slate-500" size={14} />
                        <h4 className="text-sm font-bold text-slate-900">Journal Preview</h4>
                      </div>
                      <div className="overflow-hidden rounded-xl border border-slate-200">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-100 text-slate-700">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold">Account</th>
                              <th className="px-3 py-2 text-right font-semibold">Debit</th>
                              <th className="px-3 py-2 text-right font-semibold">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeInvoiceJournalLines.map((line, index) => (
                              <tr key={`${line.accountCode}-${index}`} className="border-t border-slate-200">
                                <td className="px-3 py-2">
                                  <p className="font-semibold text-slate-900">
                                    {line.accountCode} · {line.accountName}
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-slate-500">{line.narration}</p>
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                  {line.debit ? formatCurrency(line.debit) : "-"}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                  {line.credit ? formatCurrency(line.credit) : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2">
                        <FaReceipt className="text-slate-500" size={14} />
                        <h4 className="text-sm font-bold text-slate-900">Receipt Applications</h4>
                      </div>
                      {activeInvoiceReceiptApplications.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-xs text-slate-600">
                          No receipt has been applied to this invoice yet.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {activeInvoiceReceiptApplications.map((row) => (
                            <div
                              key={row.key}
                              className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-900">{row.receiptNumber}</p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {row.receiptDate ? formatDateDisplay(row.receiptDate) : "-"} · {String(row.paymentType || "receipt").replace(/_/g, " ")}
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-600">{row.chargeLabel}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs font-bold text-green-700">{formatCurrency(row.appliedAmount)}</p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    Bal after {formatCurrency(row.afterOutstanding)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <h4 className="text-sm font-bold text-slate-900">Action Notes</h4>
                      <ul className="mt-3 space-y-2 text-xs text-slate-700">
                        <li className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                          Use <span className="font-semibold">Tenant Statement</span> to review this invoice together with receipts, allocations, and downstream balance movement.
                        </li>
                        <li className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                          Use <span className="font-semibold">Print</span> or <span className="font-semibold">Download</span> when you need the invoice in a shareable or auditable format.
                        </li>
                        <li className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                          {canDeleteActiveInvoice
                            ? "Delete remains available because this invoice is not settled from this screen."
                            : "Delete is blocked here when the invoice is already paid or partially paid, or when you do not have permission."}
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default RentalInvoices;