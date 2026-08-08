// Pure utility functions shared between RentalInvoices, SingleBookingModal, and TenantStatement.
// No React hooks here — plain JS only.

export const MONTH_OPTIONS = [
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

export const FALLBACK_BILLING_PERIOD_MONTHS = {
  monthly: 1,
  bi_monthly: 2,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

export const INVOICE_REVENUE_ACCOUNT_MAP = {
  utility: { code: "4102", name: "Utility Recharge Income", category: "UTILITY_CHARGE" },
  rent: { code: "4100", name: "Rent Income", category: "RENT_CHARGE" },
  combined: { code: "4100", name: "Rent Income", category: "RENT_CHARGE" },
};

// ─── Period / date helpers ────────────────────────────────────────────────────

export const normalizeBillingPeriodKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

export const canonicalBillingPeriodKey = (value = "") => {
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

export const addMonthsPreservingDay = (dateValue, months = 1) => {
  const source = new Date(dateValue);
  if (Number.isNaN(source.getTime())) return null;
  const day = source.getDate();
  const next = new Date(source);
  next.setMonth(next.getMonth() + Number(months || 0), 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
};

export const buildSchedulePeriodKey = ({ startDate, billingPeriodKey = "monthly" }) => {
  const dt = new Date(startDate);
  if (Number.isNaN(dt.getTime())) return "";
  return `${canonicalBillingPeriodKey(billingPeriodKey)}:${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

export const formatScheduleLabel = ({ startDate, endDate, billingPeriod }) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
  if (Number(billingPeriod?.durationInMonths || 1) <= 1) {
    return `${start.toLocaleString("en-US", { month: "short" })} ${String(start.getFullYear()).slice(-2)}`;
  }
  return `${start.toLocaleDateString("en-GB")} - ${end.toLocaleDateString("en-GB")}`;
};

export const formatPeriodLabel = (month, year) => {
  const date = new Date(year, month, 1);
  return `${date.toLocaleString("en-US", { month: "short" })} ${String(year).slice(-2)}`;
};

export const formatDateDisplay = (dateValue, options = {}) => {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", options);
};

export const getDaysInMonth = (month, year) => new Date(Number(year), Number(month) + 1, 0).getDate();

const toPeriodDateString = (year, month, day) =>
  `${String(Number(year)).padStart(4, "0")}-${String(Number(month) + 1).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;

export const normalizeDueDay = (value, month, year) => {
  const parsed = Number(value);
  const safeDay = Number.isFinite(parsed) ? Math.trunc(parsed) : 5;
  return Math.min(Math.max(safeDay, 1), getDaysInMonth(month, year));
};

export const getStartOfPeriod = (month, year) => toPeriodDateString(year, month, 1);

export const getDueDateForPeriod = (month, year, dueDay = 5) =>
  toPeriodDateString(year, month, normalizeDueDay(dueDay, month, year));

export const isFutureBillingPeriod = (month, year) => {
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (!Number.isFinite(parsedMonth) || !Number.isFinite(parsedYear)) return false;
  const selectedPeriodStart = new Date(parsedYear, parsedMonth, 1, 0, 0, 0, 0);
  if (Number.isNaN(selectedPeriodStart.getTime())) return false;
  const now = new Date();
  const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return selectedPeriodStart.getTime() > currentPeriodStart.getTime();
};

export const clampBillingPeriod = (month, year) => {
  const now = new Date();
  const fallback = { month: now.getMonth(), year: now.getFullYear() };
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (!Number.isFinite(parsedMonth) || !Number.isFinite(parsedYear)) return fallback;
  if (isFutureBillingPeriod(parsedMonth, parsedYear)) return fallback;
  return { month: parsedMonth, year: parsedYear };
};

// ─── Billing mode helpers ─────────────────────────────────────────────────────

export const normalizeBillingMode = (value = "separate") => {
  const normalized = String(value || "separate").trim().toLowerCase();
  if (["rent", "utility", "combined"].includes(normalized)) return normalized;
  return "separate";
};

export const getBillingModeLabel = (value = "separate") => {
  const normalized = normalizeBillingMode(value);
  if (normalized === "rent") return "Rent only";
  if (normalized === "utility") return "Utility only";
  if (normalized === "combined") return "Rent + Utility (combined invoice)";
  return "Rent + Utility (separate invoices)";
};

export const resolveBookingAmountsForMode = ({ rentAmount = 0, utilityAmount = 0, billingMode = "separate" } = {}) => {
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

export const createBookingGroupId = () => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return `booking_${globalThis.crypto.randomUUID()}`;
  }
  return `booking_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

// ─── Invoice description / metadata builders ──────────────────────────────────

const formatInvoiceDescriptionPeriod = (month, year) => {
  const date = new Date(year, month, 1);
  return `${date.toLocaleString("en-US", { month: "short" })}/${String(year).slice(-2)}`;
};

export const buildRecurringInvoiceDescription = ({ month, year, label }) =>
  `${formatInvoiceDescriptionPeriod(month, year)} ${String(label || "Charge").trim()}`;

export const buildUtilityChargeDescription = ({ utilityLabel = "", month, year } = {}) =>
  buildRecurringInvoiceDescription({ month, year, label: String(utilityLabel || "").trim() || "Utility" });

export const extractUtilityLabel = (utility = {}) => {
  if (!utility) return "";
  if (typeof utility === "string") return utility.trim();
  const nestedUtility = utility?.utility;
  if (typeof nestedUtility === "string" && nestedUtility.trim()) return nestedUtility.trim();
  if (nestedUtility && typeof nestedUtility === "object") {
    const nestedLabel =
      nestedUtility?.name || nestedUtility?.utilityName || nestedUtility?.label || nestedUtility?._id || "";
    if (String(nestedLabel || "").trim()) return String(nestedLabel).trim();
  }
  return String(utility?.utilityLabel || utility?.utilityName || utility?.name || utility?.label || "").trim();
};

export const buildScaledBreakdown = (rows = [], utilityAmount = 0) => {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const scale = total > 0 ? utilityAmount / total : 1;
  return rows
    .map((r) => ({ label: r.label, amount: Math.round(r.amount * scale * 100) / 100 }))
    .filter((r) => r.amount > 0);
};

export const buildCombinedInvoiceMetadata = (rows = [], utilityAmount = 0, utilityLabel = "") => {
  const breakdown = buildScaledBreakdown(rows, utilityAmount);
  return {
    billItemKey: "rent_utility:combined",
    utilityBreakdown: breakdown.length > 0 ? breakdown : [{ label: utilityLabel || "Utility", amount: utilityAmount }],
    utilityAmount,
    utilityLabel,
  };
};

export const buildUtilityInvoiceMetadata = (utilityLabel = "") => {
  const resolvedLabel = String(utilityLabel || "").trim() || "Utility";
  return {
    utilityType: resolvedLabel,
    meterUtilityType: resolvedLabel,
    statementUtilityType: resolvedLabel,
  };
};

export const buildBookingMetadata = ({ metadata = undefined, bookingGroupId = "", billingMode = "separate" } = {}) => {
  const baseMetadata = metadata && typeof metadata === "object" ? metadata : {};
  return {
    ...baseMetadata,
    bookingGroupId: bookingGroupId || baseMetadata?.bookingGroupId || "",
    bookingMode: normalizeBillingMode(billingMode),
    bookingSource: "rental_invoice_booking",
  };
};

// ─── Invoice conflict / duplicate detection ───────────────────────────────────

const normalizeUtilityConflictKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const isUtilityConflictBucket = (bucket = "") =>
  bucket === "utility" || String(bucket || "").startsWith("utility:");

export const getInvoiceConflictBucket = ({ category, metadata = {} } = {}) => {
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

const normalizeInvoiceStatus = (status = "") => String(status || "").trim().toLowerCase();
const isActiveInvoiceStatus = (status = "") => !["cancelled", "reversed"].includes(normalizeInvoiceStatus(status));

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

const isInvoiceInBillingPeriod = (dateRef, month, year) => {
  if (!dateRef) return false;
  const dt = new Date(dateRef);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getMonth() === Number(month) && dt.getFullYear() === Number(year);
};

export const getActiveInvoicesForTenantPeriod = ({ invoices = [], tenantId, unitId = null, month, year, periodKey = "" }) =>
  invoices.filter((invoice) => {
    if (String(invoice?.tenant?._id || invoice?.tenant || "") !== String(tenantId || "")) return false;
    if (unitId && String(invoice?.unit?._id || invoice?.unit || "") !== String(unitId)) return false;
    if (!isActiveInvoiceStatus(invoice?.status)) return false;
    if (isInvoiceTakeOnBalance(invoice)) return false;
    const invoicePeriodKey = String(invoice?.metadata?.periodKey || "").trim();
    if (periodKey && invoicePeriodKey) return invoicePeriodKey === String(periodKey);
    return isInvoiceInBillingPeriod(invoice?.invoiceDate || invoice?.createdAt, month, year);
  });

export const hasBlockingInvoiceForRequest = ({
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
  return getActiveInvoicesForTenantPeriod({ invoices, tenantId, unitId, month, year, periodKey }).some((invoice) =>
    doInvoiceConflictBucketsOverlap(requestedBucket, getInvoiceConflictBucket({ category: invoice?.category, metadata: invoice?.metadata || {} }))
  );
};

// ─── Form helpers ─────────────────────────────────────────────────────────────

export const getBookingTaxSelection = (form = {}) => ({
  handling: form?.taxHandling || "company_default",
  taxCodeKey: form?.taxCodeKey || "vat_standard",
  taxMode: form?.taxMode || "company_default",
});

export const resolveBookingDateOverride = (form = {}) =>
  form?.bookWithInvoiceDate ? form?.invoiceDate || null : null;

export const getTenantDisplayName = (tenant) => {
  const fullName = `${tenant?.firstName || ""} ${tenant?.lastName || ""}`.trim();
  return fullName || tenant?.tenantName || tenant?.name || "N/A";
};
