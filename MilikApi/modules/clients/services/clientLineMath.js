// Pure arithmetic shared by contracts, quotes, invoices, credit notes and the billing schedule.
// No DB access here on purpose: the ClientInvoice pre-save hook recomputes totals from the stored
// line fields with these same functions, so a preview, a posted invoice and a re-saved invoice can
// never disagree by a rounding cent.
import { round2 } from "../../../utils/math.js";
import {
  addMonthsPreservingDayUTC,
  buildSchedulePeriodKey,
  canonicalizeBillingPeriodKey,
} from "../../../services/billingPeriodService.js";

export const BILLING_FREQUENCIES = ["one_off", "monthly", "quarterly", "semi_annual", "annual"];
export const FREQUENCY_MONTHS = { one_off: 0, monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };
export const BILLING_TIMINGS = ["advance", "arrears"];
export const REVENUE_RECOGNITION_METHODS = ["on_invoice", "straight_line", "milestone"];
export const DEFERRED_RECOGNITION_METHODS = new Set(["straight_line", "milestone"]);
export const TAX_MODES = ["exclusive", "inclusive"];

const DAY_MS = 24 * 60 * 60 * 1000;

export const normalizeFrequency = (value, fallback = "monthly") => {
  const raw = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (["one_off", "oneoff", "once", "one_time", "onetime"].includes(raw)) return "one_off";
  const key = canonicalizeBillingPeriodKey(raw || fallback);
  return FREQUENCY_MONTHS[key] !== undefined ? key : fallback;
};

export const toUTCDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

export const addDaysUTC = (date, days) => new Date(date.getTime() + days * DAY_MS);
export const daysInclusive = (from, to) => Math.round((toUTCDate(to) - toUTCDate(from)) / DAY_MS) + 1;
export const monthKeyOf = (date) => {
  const d = toUTCDate(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const isoDay = (date) => toUTCDate(date)?.toISOString().slice(0, 10) || "";

// Same arithmetic as services/taxCalculationService.js calculateTaxBreakdown, applied after the line
// discount. Only "vat" carries a rate; zero_rated/exempt/none are taxable-at-0 or out of scope, but the
// type is still kept on the line so the VAT return can report zero-rated and exempt sales separately.
export const calculateLineAmounts = ({
  quantity = 1,
  unitPrice = 0,
  discountPercent = 0,
  taxRate = 0,
  taxType = "none",
  taxMode = "exclusive",
  prorationFactor = 1,
} = {}) => {
  const qty = Math.max(0, Number(quantity || 0));
  const price = Math.max(0, Number(unitPrice || 0));
  const factor = Number.isFinite(Number(prorationFactor)) ? Math.max(0, Number(prorationFactor)) : 1;
  const discountPct = Math.min(100, Math.max(0, Number(discountPercent || 0)));
  const rate = String(taxType || "").toLowerCase() === "vat" ? Math.max(0, Number(taxRate || 0)) : 0;

  const grossBeforeDiscount = round2(qty * price * factor);
  const discountAmount = round2((grossBeforeDiscount * discountPct) / 100);
  const lineAmount = round2(grossBeforeDiscount - discountAmount);

  if (rate <= 0 || lineAmount <= 0) {
    return { grossBeforeDiscount, discountAmount, lineAmount, netAmount: lineAmount, taxAmount: 0, totalAmount: lineAmount };
  }
  if (String(taxMode).toLowerCase() === "inclusive") {
    const netAmount = round2(lineAmount / (1 + rate / 100));
    return { grossBeforeDiscount, discountAmount, lineAmount, netAmount, taxAmount: round2(lineAmount - netAmount), totalAmount: lineAmount };
  }
  const taxAmount = round2((lineAmount * rate) / 100);
  return { grossBeforeDiscount, discountAmount, lineAmount, netAmount: lineAmount, taxAmount, totalAmount: round2(lineAmount + taxAmount) };
};

export const summarizeLines = (lines = []) => {
  let subtotal = 0;
  let taxAmount = 0;
  let total = 0;
  let discountTotal = 0;
  for (const line of lines) {
    subtotal += Number(line.netAmount ?? line.amount ?? 0);
    taxAmount += Number(line.taxAmount || 0);
    total += Number(line.totalAmount ?? (Number(line.netAmount ?? line.amount ?? 0) + Number(line.taxAmount || 0)));
    discountTotal += Number(line.discountAmount || 0);
  }
  return { subtotal: round2(subtotal), taxAmount: round2(taxAmount), total: round2(total), discountTotal: round2(discountTotal) };
};

// ─── Contract lines & metrics ─────────────────────────────────────────────────

const LEGACY_CYCLE_MAP = { monthly: "monthly", quarterly: "quarterly", annually: "annual" };
export const LEGACY_LINE_KEY = "legacy";

export const lineKeyOf = (line) => String(line?.lineKey || line?._id || LEGACY_LINE_KEY);

// A contract saved before lines existed is billed as one line of currentValue on its old billingCycle
// (monthly unless the contract said otherwise), so old contracts keep working without a migration.
export const effectiveContractLines = (contract = {}) => {
  const lines = Array.isArray(contract.lines) ? contract.lines.filter(Boolean) : [];
  if (lines.length) return lines;
  const value = Number(contract.currentValue ?? contract.baseValue ?? 0);
  if (!(value > 0)) return [];
  return [{
    lineKey: LEGACY_LINE_KEY,
    itemName: contract.description || "Contract fee",
    description: contract.description || "",
    quantity: 1,
    unitPrice: value,
    discountPercent: 0,
    taxCodeKey: null,
    taxRate: 0,
    taxType: "none",
    billingFrequency: LEGACY_CYCLE_MAP[contract.billingCycle] || "monthly",
    billingTiming: "advance",
    revenueRecognition: "on_invoice",
    incomeAccount: null,
    startDate: null,
    endDate: null,
    isLegacy: true,
  }];
};

// Whole months between two dates plus the fraction of the next month, with `to` inclusive —
// so 1 Jan–31 Dec is exactly 12, not 11.97.
export const monthsBetweenInclusive = (from, to) => {
  const start = toUTCDate(from);
  const endExclusive = addDaysUTC(toUTCDate(to), 1);
  if (!start || !endExclusive || endExclusive <= start) return 0;
  let months = 0;
  let cursor = start;
  while (months < 1200) {
    const next = addMonthsPreservingDayUTC(start, months + 1);
    if (next > endExclusive) break;
    months += 1;
    cursor = next;
  }
  const nextFull = addMonthsPreservingDayUTC(start, months + 1);
  const remainder = (endExclusive - cursor) / (nextFull - cursor);
  return round2(months + (remainder > 0 ? remainder : 0));
};

const contractTermMonths = (contract) => {
  if (!contract.openEnded && contract.endDate && contract.startDate) {
    return monthsBetweenInclusive(contract.startDate, contract.endDate);
  }
  return Math.max(Number(contract.minimumTermMonths || 0), 12);
};

const lineTermMonths = (line, contract) => {
  const contractEnd = !contract.openEnded && contract.endDate ? toUTCDate(contract.endDate) : null;
  const start = toUTCDate(line.startDate) && toUTCDate(contract.startDate)
    ? new Date(Math.max(toUTCDate(line.startDate), toUTCDate(contract.startDate)))
    : toUTCDate(line.startDate || contract.startDate);
  const lineEnd = toUTCDate(line.endDate);
  const end = lineEnd && contractEnd ? new Date(Math.min(lineEnd, contractEnd)) : lineEnd || contractEnd;
  if (start && end) return monthsBetweenInclusive(start, end);
  return contractTermMonths(contract);
};

// Contract value metrics, all net of tax (what the company earns, not what it collects for KRA).
export const computeContractMetrics = (contract = {}, { taxMode } = {}) => {
  const mode = taxMode || contract.taxMode || "exclusive";
  let mrr = 0;
  let tcv = 0;
  for (const line of effectiveContractLines(contract)) {
    const { netAmount } = calculateLineAmounts({ ...line, taxMode: mode });
    const months = FREQUENCY_MONTHS[normalizeFrequency(line.billingFrequency)] || 0;
    if (months === 0) {
      tcv += netAmount;
      continue;
    }
    const monthly = netAmount / months;
    mrr += monthly;
    tcv += monthly * lineTermMonths(line, contract);
  }
  const term = contractTermMonths(contract);
  const acv = term >= 12 ? (tcv * 12) / term : tcv;
  return { mrr: round2(mrr), tcv: round2(tcv), acv: round2(acv), termMonths: term };
};

// ─── Billing schedule generation ──────────────────────────────────────────────

// Versions are [{ version, effectiveDate, lines }]. The price a period is billed at is the one in the
// version in force on the period's first day — so an amendment effective 1 March never re-prices a
// February period that happens to still be unbilled (arrears).
const versionAt = (versions, date) => {
  let chosen = versions[0];
  for (const v of versions) {
    if (!v.effectiveDate || toUTCDate(v.effectiveDate) <= date) chosen = v;
  }
  return chosen;
};

export const buildScheduleIdempotencyKey = ({ contractId, lineKey, periodKey }) =>
  ["client_billing", String(contractId || ""), String(lineKey || ""), String(periodKey || "")].join(":");

const resolveBillingDayAnchor = (start, billingDay) => {
  const day = Number(billingDay || 0);
  if (!(day >= 1 && day <= 28) || start.getUTCDate() === day) return start;
  const sameMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day));
  return sameMonth > start ? sameMonth : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day));
};

const linePeriods = ({ line, contract, horizonEnd }) => {
  const contractStart = toUTCDate(contract.startDate);
  const lineStart = toUTCDate(line.startDate);
  const start = lineStart && contractStart ? new Date(Math.max(lineStart, contractStart)) : lineStart || contractStart;
  if (!start) return [];

  const ends = [
    !contract.openEnded ? toUTCDate(contract.endDate) : null,
    toUTCDate(line.endDate),
    contract.terminationEffectiveDate ? addDaysUTC(toUTCDate(contract.terminationEffectiveDate), -1) : null,
  ].filter(Boolean);
  const end = ends.length ? new Date(Math.min(...ends)) : null;
  if (end && end < start) return [];

  const frequency = normalizeFrequency(line.billingFrequency);
  const timing = line.billingTiming === "arrears" ? "arrears" : "advance";
  const daily = contract.prorationRule === "daily";

  if (frequency === "one_off") {
    return [{ from: start, to: start, billingDate: start, prorationFactor: 1, frequency, periodKey: `one_off:${isoDay(start)}` }];
  }

  const months = FREQUENCY_MONTHS[frequency];
  const anchor = resolveBillingDayAnchor(start, contract.billingDay);
  const periods = [];

  // Stub before the first billing-day anchor (e.g. start 10th, bill on the 1st).
  if (anchor > start) {
    const fullFrom = addMonthsPreservingDayUTC(anchor, -months);
    let to = addDaysUTC(anchor, -1);
    if (end && to > end) to = end;
    const factor = daily ? daysInclusive(start, to) / daysInclusive(fullFrom, addDaysUTC(anchor, -1)) : 1;
    periods.push({ from: start, to, factor });
  }

  for (let k = 0; k < 1200; k++) {
    const from = addMonthsPreservingDayUTC(anchor, k * months);
    if (end && from > end) break;
    if (horizonEnd && from > horizonEnd) break;
    const fullTo = addDaysUTC(addMonthsPreservingDayUTC(anchor, (k + 1) * months), -1);
    let to = fullTo;
    let factor = 1;
    if (end && fullTo > end) {
      to = end;
      factor = daily ? daysInclusive(from, to) / daysInclusive(from, fullTo) : 1;
    }
    periods.push({ from, to, factor });
  }

  return periods
    .filter((p) => !horizonEnd || p.from <= horizonEnd)
    .map((p) => ({
      from: p.from,
      to: p.to,
      billingDate: timing === "arrears" ? p.to : p.from,
      prorationFactor: p.factor,
      frequency,
      periodKey: buildSchedulePeriodKey({ startDate: p.from, billingPeriodKey: frequency }),
    }));
};

// Every line-period the contract should ever bill, up to horizonEnd for open-ended terms. Lines are the
// union across versions (a line removed by an amendment still owns its earlier periods), each period
// priced from the version in force on its first day and dropped when that version doesn't have it.
export const buildContractSchedule = ({ contract, versions = null, horizonEnd = null }) => {
  const versionList = (versions && versions.length
    ? [...versions].sort((a, b) => (toUTCDate(a.effectiveDate) || 0) - (toUTCDate(b.effectiveDate) || 0))
    : [{ version: contract.version || 1, effectiveDate: null, lines: effectiveContractLines(contract) }]
  ).map((v) => ({ ...v, lines: v.lines?.length ? v.lines : effectiveContractLines({ ...contract, lines: v.lines }) }));

  const lineUnion = new Map();
  for (const v of versionList) {
    for (const line of v.lines) {
      const key = lineKeyOf(line);
      if (!lineUnion.has(key)) lineUnion.set(key, line);
    }
  }
  // Period boundaries come from the line's first appearance; prices come from the version at `from`.
  const rows = [];
  for (const [lineKey, firstLine] of lineUnion) {
    const latest = [...versionList].reverse().find((v) => v.lines.some((l) => lineKeyOf(l) === lineKey));
    const boundaryLine = latest?.lines.find((l) => lineKeyOf(l) === lineKey) || firstLine;
    for (const period of linePeriods({ line: boundaryLine, contract, horizonEnd })) {
      const version = versionAt(versionList, period.from);
      const line = version.lines.find((l) => lineKeyOf(l) === lineKey);
      if (!line) continue;
      rows.push({
        lineKey,
        periodKey: period.periodKey,
        idempotencyKey: buildScheduleIdempotencyKey({ contractId: contract._id, lineKey, periodKey: period.periodKey }),
        from: period.from,
        to: period.to,
        billingDate: period.billingDate,
        prorationFactor: period.prorationFactor,
        contractVersion: version.version || 1,
        itemName: line.itemName || line.description || "Service",
        description: line.description || "",
        quantity: Number(line.quantity ?? 1),
        unitPrice: Number(line.unitPrice || 0),
        discountPercent: Number(line.discountPercent || 0),
        taxCodeKey: line.taxCodeKey || null,
        billingFrequency: period.frequency,
        billingTiming: line.billingTiming === "arrears" ? "arrears" : "advance",
        revenueRecognition: REVENUE_RECOGNITION_METHODS.includes(line.revenueRecognition) ? line.revenueRecognition : "on_invoice",
        incomeAccount: line.incomeAccount || null,
      });
    }
  }
  return rows.sort((a, b) => a.billingDate - b.billingDate || a.lineKey.localeCompare(b.lineKey));
};

// Straight-line allocation of an amount across the calendar months of a service period, by days, with
// the rounding remainder on the last month so the parts always sum to the whole.
export const allocateAcrossMonths = ({ amount, from, to }) => {
  const start = toUTCDate(from);
  const end = toUTCDate(to || from);
  const total = round2(amount);
  if (!start || !end || end < start) return [{ month: monthKeyOf(start || new Date()), amount: total }];
  const totalDays = daysInclusive(start, end);
  const parts = [];
  let cursor = start;
  while (cursor <= end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const segEnd = monthEnd < end ? monthEnd : end;
    parts.push({ month: monthKeyOf(cursor), days: daysInclusive(cursor, segEnd) });
    cursor = addDaysUTC(segEnd, 1);
  }
  let allocated = 0;
  return parts.map((p, i) => {
    const value = i === parts.length - 1 ? round2(total - allocated) : round2((total * p.days) / totalDays);
    allocated = round2(allocated + value);
    return { month: p.month, amount: value };
  });
};

export const monthEndDate = (monthKey) => {
  const [y, m] = String(monthKey).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
};
