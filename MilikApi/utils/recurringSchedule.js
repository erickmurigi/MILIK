import { round2 } from "./math.js";

const normalizeFrequency = (value) => {
  const normalized = String(value || "monthly").trim().toLowerCase();
  if (["weekly", "monthly", "quarterly", "semi_annually", "annually", "yearly", "custom"].includes(normalized)) {
    return normalized;
  }
  if (["semi-annually", "semiannually"].includes(normalized)) return "semi_annually";
  if (normalized === "annual") return "annually";
  return "monthly";
};

const parseDate = (value, fallback = null) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const normalizeToStartOfDay = (value) => {
  const date = parseDate(value, null);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const normalizeToEndOfDay = (value) => {
  const date = parseDate(value, null);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();

const alignDayOfMonth = (dateValue, desiredDay) => {
  const date = new Date(dateValue);
  const maxDay = daysInMonth(date.getFullYear(), date.getMonth());
  date.setDate(Math.min(Math.max(Number(desiredDay || date.getDate() || 1), 1), maxDay));
  return date;
};

const addMonths = (dateValue, months, dayOfMonth = null) => {
  const date = new Date(dateValue);
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const desired = Number.isFinite(Number(dayOfMonth)) ? Number(dayOfMonth) : originalDay;
  date.setDate(Math.min(Math.max(desired, 1), daysInMonth(date.getFullYear(), date.getMonth())));
  return date;
};

const addFrequency = (dateValue, frequency, dayOfMonth = null) => {
  const normalized = normalizeFrequency(frequency);
  const date = parseDate(dateValue, null);
  if (!date) return null;

  if (normalized === "weekly") {
    const next = new Date(date);
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (normalized === "quarterly") return addMonths(date, 3, dayOfMonth);
  if (normalized === "semi_annually") return addMonths(date, 6, dayOfMonth);
  if (normalized === "annually" || normalized === "yearly") {
    const next = new Date(date);
    next.setFullYear(next.getFullYear() + 1);
    return alignDayOfMonth(next, dayOfMonth || date.getDate());
  }

  return addMonths(date, 1, dayOfMonth);
};

const startOfWeek = (dateValue) => {
  const date = normalizeToStartOfDay(dateValue);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
};

const endOfWeek = (dateValue) => {
  const start = startOfWeek(dateValue);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
};

const startOfMonth = (dateValue) => {
  const date = normalizeToStartOfDay(dateValue);
  date.setDate(1);
  return date;
};

const endOfMonth = (dateValue) => {
  const date = normalizeToEndOfDay(dateValue);
  date.setMonth(date.getMonth() + 1, 0);
  return date;
};

const startOfQuarter = (dateValue) => {
  const date = normalizeToStartOfDay(dateValue);
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  date.setMonth(quarterStartMonth, 1);
  return date;
};

const endOfQuarter = (dateValue) => {
  const start = startOfQuarter(dateValue);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 3, 0);
  end.setHours(23, 59, 59, 999);
  return end;
};

const startOfHalfYear = (dateValue) => {
  const date = normalizeToStartOfDay(dateValue);
  const startMonth = date.getMonth() < 6 ? 0 : 6;
  date.setMonth(startMonth, 1);
  return date;
};

const endOfHalfYear = (dateValue) => {
  const start = startOfHalfYear(dateValue);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 6, 0);
  end.setHours(23, 59, 59, 999);
  return end;
};

const startOfYear = (dateValue) => {
  const date = normalizeToStartOfDay(dateValue);
  date.setMonth(0, 1);
  return date;
};

const endOfYear = (dateValue) => {
  const date = normalizeToEndOfDay(dateValue);
  date.setMonth(11, 31);
  return date;
};

const getQuarterNumber = (dateValue) => Math.floor(new Date(dateValue).getMonth() / 3) + 1;
const getHalfNumber = (dateValue) => (new Date(dateValue).getMonth() < 6 ? 1 : 2);

const getPeriodBoundsForDate = (dateValue, frequency) => {
  const normalized = normalizeFrequency(frequency);
  const date = parseDate(dateValue, null);
  if (!date) return { periodStart: null, periodEnd: null };

  if (normalized === "weekly") {
    return { periodStart: startOfWeek(date), periodEnd: endOfWeek(date) };
  }
  if (normalized === "quarterly") {
    return { periodStart: startOfQuarter(date), periodEnd: endOfQuarter(date) };
  }
  if (normalized === "semi_annually") {
    return { periodStart: startOfHalfYear(date), periodEnd: endOfHalfYear(date) };
  }
  if (normalized === "annually" || normalized === "yearly") {
    return { periodStart: startOfYear(date), periodEnd: endOfYear(date) };
  }
  return { periodStart: startOfMonth(date), periodEnd: endOfMonth(date) };
};

const getPeriodKey = (dateValue, frequency) => {
  const normalized = normalizeFrequency(frequency);
  const date = parseDate(dateValue, null);
  if (!date) return "";
  const year = date.getFullYear();

  if (normalized === "weekly") {
    const weekStart = startOfWeek(date);
    return `W-${weekStart.toISOString().slice(0, 10)}`;
  }
  if (normalized === "quarterly") return `${year}-Q${getQuarterNumber(date)}`;
  if (normalized === "semi_annually") return `${year}-H${getHalfNumber(date)}`;
  if (normalized === "annually" || normalized === "yearly") return `${year}`;
  return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const getPeriodLabel = (dateValue, frequency) => {
  const normalized = normalizeFrequency(frequency);
  const date = parseDate(dateValue, null);
  if (!date) return "";
  const year = date.getFullYear();

  if (normalized === "weekly") {
    const start = startOfWeek(date);
    const end = endOfWeek(date);
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  }
  if (normalized === "quarterly") return `Q${getQuarterNumber(date)} ${year}`;
  if (normalized === "semi_annually") return `H${getHalfNumber(date)} ${year}`;
  if (normalized === "annually" || normalized === "yearly") return `${year}`;
  return `${MONTH_NAMES[date.getMonth()]} ${year}`;
};

const comparePeriodOrder = (left, right) => {
  const leftDate = normalizeToStartOfDay(left?.periodStart || left?.dueDate || left?.date || left);
  const rightDate = normalizeToStartOfDay(right?.periodStart || right?.dueDate || right?.date || right);
  if (!leftDate && !rightDate) return 0;
  if (!leftDate) return -1;
  if (!rightDate) return 1;
  return leftDate.getTime() - rightDate.getTime();
};

const buildRunSchedule = ({ startDate, endDate = null, frequency = "monthly", dayOfMonth = null, capAt = null } = {}) => {
  const normalizedFrequency = normalizeFrequency(frequency);
  const seedStart = normalizeToStartOfDay(startDate);
  if (!seedStart) return [];
  const hardEnd = normalizeToEndOfDay(endDate || capAt || null);
  const boundaryEnd = normalizeToEndOfDay(capAt || endDate || null);
  const schedule = [];
  const seenKeys = new Set();
  let cursor = new Date(seedStart);
  let guard = 0;

  while (cursor && guard < 1000) {
    guard += 1;
    if (boundaryEnd && cursor.getTime() > boundaryEnd.getTime()) break;

    const { periodStart, periodEnd } = getPeriodBoundsForDate(cursor, normalizedFrequency);
    if (!periodStart || !periodEnd) break;
    if (hardEnd && periodStart.getTime() > hardEnd.getTime()) break;

    const periodKey = getPeriodKey(cursor, normalizedFrequency);
    if (!seenKeys.has(periodKey)) {
      schedule.push({
        dueDate: new Date(cursor),
        periodStart,
        periodEnd,
        periodKey,
        periodLabel: getPeriodLabel(cursor, normalizedFrequency),
        frequency: normalizedFrequency,
      });
      seenKeys.add(periodKey);
    }

    const nextCursor = addFrequency(cursor, normalizedFrequency, dayOfMonth);
    if (!nextCursor || nextCursor.getTime() <= cursor.getTime()) break;
    cursor = normalizeToStartOfDay(nextCursor);
  }

  return schedule.sort(comparePeriodOrder);
};

const filterEligibleSchedule = ({ schedule = [], runHistory = [], now = new Date(), frequency = "monthly" } = {}) => {
  const currentPeriodStart = getPeriodBoundsForDate(now, frequency).periodStart;
  const currentCutoff = normalizeToStartOfDay(currentPeriodStart || now);

  const processedKeys = new Set(
    (Array.isArray(runHistory) ? runHistory : [])
      .map((item) => String(item?.periodKey || getPeriodKey(item?.dueDate || item?.runDate, frequency) || "").trim())
      .filter(Boolean)
  );

  return (Array.isArray(schedule) ? schedule : [])
    .filter((item) => item?.periodKey && !processedKeys.has(item.periodKey))
    .filter((item) => {
      const start = normalizeToStartOfDay(item.periodStart);
      return start && currentCutoff ? start.getTime() <= currentCutoff.getTime() : true;
    })
    .sort(comparePeriodOrder);
};

export {
  round2,
  parseDate,
  normalizeFrequency,
  normalizeToStartOfDay,
  normalizeToEndOfDay,
  addFrequency,
  getPeriodBoundsForDate,
  getPeriodKey,
  getPeriodLabel,
  comparePeriodOrder,
  buildRunSchedule,
  filterEligibleSchedule,
};

export default {
  round2,
  parseDate,
  normalizeFrequency,
  normalizeToStartOfDay,
  normalizeToEndOfDay,
  addFrequency,
  getPeriodBoundsForDate,
  getPeriodKey,
  getPeriodLabel,
  comparePeriodOrder,
  buildRunSchedule,
  filterEligibleSchedule,
};
