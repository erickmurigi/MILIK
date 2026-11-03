import mongoose from "mongoose";

export const DEFAULT_BILLING_PERIODS = [
  { key: "monthly", name: "Monthly", durationInMonths: 1, durationInDays: 30, isActive: true },
  { key: "quarterly", name: "Quarterly", durationInMonths: 3, durationInDays: 90, isActive: true },
  { key: "semi_annual", name: "Semi-Annual", durationInMonths: 6, durationInDays: 180, isActive: true },
  { key: "annual", name: "Annual", durationInMonths: 12, durationInDays: 365, isActive: true },
];

const normalizeText = (value = "") => String(value ?? "").trim();

export const normalizeBillingPeriodKey = (value = "") =>
  normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const LEGACY_KEY_ALIASES = {
  monthly: "monthly",
  month: "monthly",
  quarterly: "quarterly",
  quarter: "quarterly",
  annually: "annual",
  annual: "annual",
  yearly: "annual",
  year: "annual",
  semi_annual: "semi_annual",
  semiannual: "semi_annual",
  semi_annually: "semi_annual",
  biannual: "semi_annual",
  bi_annually: "semi_annual",
  bimonthly: "bi_monthly",
  bi_monthly: "bi_monthly",
  every_2_months: "bi_monthly",
};

export const canonicalizeBillingPeriodKey = (value = "") => {
  const normalized = normalizeBillingPeriodKey(value);
  return LEGACY_KEY_ALIASES[normalized] || normalized || "monthly";
};

// Schedule period key: billing key + the date the period is anchored on (the lease start).
// Same format the client's schedule builds. Dates are read in UTC, which matches how
// "YYYY-MM-DD" move-in and start dates are stored (midnight UTC).
export const buildSchedulePeriodKey = ({ startDate, billingPeriodKey = "monthly" } = {}) => {
  const dt = new Date(startDate);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${canonicalizeBillingPeriodKey(billingPeriodKey)}:${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

export const addMonthsPreservingDayUTC = (date, months = 1) => {
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(months || 0), 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
};

// The one correct way to find "this calendar month's occurrence" of a lease's recurring billing
// schedule. Using the lease's raw startDate directly as the period anchor (what this codebase used
// to do everywhere) only happens to be right for a lease's very first billing month — every month
// after that needs the schedule walked forward from the anchor, preserving day-of-month the same
// way the booking UI already does client-side (invoiceBookingUtils.js's addMonthsPreservingDay /
// resolveTenantBookingPeriod). Two code paths computing periodKey two different ways for the same
// tenant/unit/calendar month is exactly how a cron-generated invoice and a manually-booked invoice
// for the same month ended up with different periodKey strings, silently defeating the
// duplicate-invoice guard that's supposed to compare them (a real production incident — see
// controllers/propertyController/tenantInvoices.test.js for the regression test).
const MAX_SCHEDULE_ITERATIONS = 2400; // ~200 years of monthly periods — a safety bound, not a real limit

export const resolveOccurrencePeriodStart = ({
  leaseStartDate,
  billingPeriodKey = "monthly",
  durationInMonths = 1,
  targetYear,
  targetMonth,
} = {}) => {
  const anchor = new Date(leaseStartDate);
  if (Number.isNaN(anchor.getTime()) || !Number.isFinite(targetYear) || !Number.isFinite(targetMonth)) return null;
  const months = Math.max(1, Math.trunc(Number(durationInMonths) || 1));

  let current = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  for (let i = 0; i < MAX_SCHEDULE_ITERATIONS; i++) {
    if (current.getUTCFullYear() === targetYear && current.getUTCMonth() === targetMonth) {
      return current;
    }
    const next = addMonthsPreservingDayUTC(current, months);
    if (next.getTime() <= current.getTime()) break; // guard against a stuck loop
    // Walked past the target without landing on it — an irregular (e.g. quarterly) schedule only
    // lands on some months, never the target's, so there is no occurrence to return.
    if (next.getUTCFullYear() > targetYear || (next.getUTCFullYear() === targetYear && next.getUTCMonth() > targetMonth)) {
      return null;
    }
    current = next;
  }
  return null;
};

// Canonical idempotency key for a recurring tenant charge — the SAME format every caller (cron,
// manual booking, batch booking) must use for the same tenant/unit/category/period, so the unique
// {business, idempotencyKey} index on TenantInvoice (models/TenantInvoice.js) actually catches a
// cross-path duplicate, not just two calls from the same path racing each other.
export const buildRecurringChargeIdempotencyKey = ({ tenantId, unitId, category, utilityType = "", periodKey = "" } = {}) =>
  [
    "recurring_charge",
    String(tenantId || ""),
    String(unitId || ""),
    String(category || "").toUpperCase(),
    String(utilityType || "").trim().toLowerCase(),
    String(periodKey || "").trim(),
  ].join(":");

export const buildBillingPeriodRecord = (input = {}, fallback = null) => {
  const fallbackDurationMonths = Number(fallback?.durationInMonths || 1);
  const durationInMonthsRaw = Number(input?.durationInMonths ?? fallback?.durationInMonths ?? 1);
  const durationInMonths = Number.isFinite(durationInMonthsRaw) && durationInMonthsRaw > 0
    ? Math.max(1, Math.trunc(durationInMonthsRaw))
    : Math.max(1, Math.trunc(fallbackDurationMonths || 1));

  const durationInDaysRaw = Number(input?.durationInDays ?? fallback?.durationInDays ?? durationInMonths * 30);
  const durationInDays = Number.isFinite(durationInDaysRaw) && durationInDaysRaw > 0
    ? Math.max(1, Math.trunc(durationInDaysRaw))
    : durationInMonths * 30;

  const name = normalizeText(input?.name ?? fallback?.name ?? "Billing Period") || "Billing Period";
  const derivedKey = canonicalizeBillingPeriodKey(input?.key || name || fallback?.key || "monthly");

  return {
    _id:
      input?._id instanceof mongoose.Types.ObjectId
        ? input._id
        : fallback?._id instanceof mongoose.Types.ObjectId
        ? fallback._id
        : new mongoose.Types.ObjectId(),
    key: derivedKey,
    name,
    durationInMonths,
    durationInDays,
    isActive: input?.isActive !== undefined ? input.isActive !== false : fallback?.isActive !== false,
  };
};

export const normalizeBillingPeriods = (periods = []) => {
  const source = Array.isArray(periods) && periods.length > 0 ? periods : DEFAULT_BILLING_PERIODS;
  const normalized = [];
  const seenKeys = new Set();

  for (const item of source) {
    const record = buildBillingPeriodRecord(item);
    if (!record.key || seenKeys.has(record.key)) continue;
    seenKeys.add(record.key);
    normalized.push(record);
  }

  const hasMonthly = normalized.some((item) => item.key === "monthly");
  if (!hasMonthly) {
    normalized.unshift(buildBillingPeriodRecord(DEFAULT_BILLING_PERIODS[0]));
  }

  return normalized;
};

export const ensureSettingsBillingPeriods = (settings) => {
  if (!settings) return settings;
  const normalized = normalizeBillingPeriods(settings.billingPeriods);

  const changed =
    !Array.isArray(settings.billingPeriods) ||
    settings.billingPeriods.length !== normalized.length ||
    normalized.some((item, index) => {
      const current = settings.billingPeriods?.[index] || {};
      const rawCurrentKey = normalizeText(current?.key);
      return (
        !rawCurrentKey ||
        canonicalizeBillingPeriodKey(rawCurrentKey || current?.name) !== item.key ||
        normalizeText(current?.name) !== item.name ||
        Number(current?.durationInMonths || 0) !== item.durationInMonths ||
        Number(current?.durationInDays || 0) !== item.durationInDays ||
        Boolean(current?.isActive !== false) !== Boolean(item.isActive !== false)
      );
    });

  if (!changed) return settings;

  if (typeof settings.set === "function") {
    settings.set("billingPeriods", normalized);
    settings.markModified("billingPeriods");
  } else {
    settings.billingPeriods = normalized;
  }

  return settings;
};

export const resolveBillingPeriodFromSettings = (settingsOrPeriods = null, candidate = null) => {
  const periods = Array.isArray(settingsOrPeriods?.billingPeriods)
    ? settingsOrPeriods.billingPeriods
    : Array.isArray(settingsOrPeriods)
    ? settingsOrPeriods
    : DEFAULT_BILLING_PERIODS;

  const normalizedPeriods = normalizeBillingPeriods(periods);
  const normalizedCandidate = canonicalizeBillingPeriodKey(candidate || "monthly");

  return (
    normalizedPeriods.find((item) => item.key === normalizedCandidate) ||
    normalizedPeriods.find((item) => canonicalizeBillingPeriodKey(item?.name) === normalizedCandidate) ||
    normalizedPeriods.find((item) => item.key === "monthly") ||
    buildBillingPeriodRecord(DEFAULT_BILLING_PERIODS[0])
  );
};

export const resolveBillingPeriodKey = (settingsOrPeriods = null, candidate = null) =>
  resolveBillingPeriodFromSettings(settingsOrPeriods, candidate)?.key || "monthly";
