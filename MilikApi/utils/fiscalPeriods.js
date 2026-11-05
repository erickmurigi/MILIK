// Fiscal years and accounting-period boundaries.
//
// Period boundaries are whole days in East Africa Time (UTC+3, no daylight saving). Transactions here
// are stored either as UTC midnight (date-only input) or as EAT midnight (21:00Z the day before), and
// an EAT day contains both, so a period starting 1 Oct catches every 1 Oct transaction either way.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

const pad = (n) => String(n).padStart(2, "0");

export const isYmd = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

// The EAT calendar date of a moment, as YYYY-MM-DD.
export const toYmd = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
};

// A YYYY-MM-DD (or anything Date can read) as the first / last instant of that EAT day.
export const dayStart = (value) => {
  const ymd = isYmd(value) ? value : toYmd(value);
  if (!ymd) return null;
  return new Date(Date.parse(`${ymd}T00:00:00.000Z`) - EAT_OFFSET_MS);
};
export const dayEnd = (value) => {
  const start = dayStart(value);
  return start ? new Date(start.getTime() + DAY_MS - 1) : null;
};

const addDaysYmd = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const nextDayYmd = (ymd) => addDaysYmd(ymd, 1);
export const prevDayYmd = (ymd) => addDaysYmd(ymd, -1);

const lastDayOfMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

// "July" / "Jul" / 7 / "7" -> 6. Anything unreadable is January.
export const fiscalStartMonthIndex = (company = {}) => {
  const raw = company?.fiscalStartMonth;
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n - 1;
  const idx = MONTHS.findIndex((m) => m.toLowerCase().startsWith(String(raw).trim().toLowerCase().slice(0, 3)));
  return idx >= 0 ? idx : 0;
};

// The fiscal year starting in `startYear`. Labelled by its months: "FY 2026" when it runs January to
// December, "FY 2025/26" otherwise.
export const fiscalYearFromStart = (startYear, startMonthIndex = 0) => {
  const startYmd = `${startYear}-${pad(startMonthIndex + 1)}-01`;
  const endMonth = (startMonthIndex + 11) % 12;
  const endYear = startMonthIndex === 0 ? startYear : startYear + 1;
  const endYmd = `${endYear}-${pad(endMonth + 1)}-${pad(lastDayOfMonth(endYear, endMonth))}`;
  const label = startMonthIndex === 0 ? `FY ${startYear}` : `FY ${startYear}/${String(endYear).slice(-2)}`;
  return { key: startYmd, label, startYmd, endYmd, startDate: dayStart(startYmd), endDate: dayEnd(endYmd), startYear };
};

export const fiscalYearOf = (value, startMonthIndex = 0) => {
  const ymd = isYmd(value) ? value : toYmd(value);
  const [year, month] = ymd.split("-").map(Number);
  const startYear = month - 1 >= startMonthIndex ? year : year - 1;
  return fiscalYearFromStart(startYear, startMonthIndex);
};

// The twelve calendar-month periods of a fiscal year.
export const monthlyPeriodsOf = (fiscalYear) => {
  const [startYear, startMonth] = fiscalYear.startYmd.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const monthIndex = (startMonth - 1 + i) % 12;
    const year = startYear + Math.floor((startMonth - 1 + i) / 12);
    const startYmd = `${year}-${pad(monthIndex + 1)}-01`;
    const endYmd = `${year}-${pad(monthIndex + 1)}-${pad(lastDayOfMonth(year, monthIndex))}`;
    return { name: `${SHORT[monthIndex]} ${year}`, startYmd, endYmd };
  });
};
