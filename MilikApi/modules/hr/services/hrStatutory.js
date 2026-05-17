/**
 * Kenya statutory payroll deduction calculations.
 * All amounts are monthly KES.
 *
 * Pass a config object (from HRStatutoryConfig) to use company-specific rates.
 * Omit config (or pass null) to fall back to Kenya 2024 defaults.
 */

export const DEFAULT_CONFIG = {
  personalRelief: 2400,
  payeBands: [
    { upTo: 24000,   rate: 0.10 },
    { upTo: 32333,   rate: 0.25 },
    { upTo: 500000,  rate: 0.30 },
    { upTo: 800000,  rate: 0.325 },
    { upTo: null,    rate: 0.35 },   // top band — unbounded
  ],
  shaRate:   0.0275,
  shaMin:    500,
  nssfLower: 7000,
  nssfUpper: 36000,
  nssfRate:  0.06,
  ahlRate:   0.015,
};

/** Convert a HRStatutoryConfig Mongoose doc (lean) to runtime config. */
export function cfgFromDoc(doc) {
  if (!doc) return DEFAULT_CONFIG;
  return {
    personalRelief: doc.personalRelief ?? DEFAULT_CONFIG.personalRelief,
    payeBands:      doc.payeBands?.length ? doc.payeBands : DEFAULT_CONFIG.payeBands,
    shaRate:        doc.shaRate   ?? DEFAULT_CONFIG.shaRate,
    shaMin:         doc.shaMin    ?? DEFAULT_CONFIG.shaMin,
    nssfLower:      doc.nssfLower ?? DEFAULT_CONFIG.nssfLower,
    nssfUpper:      doc.nssfUpper ?? DEFAULT_CONFIG.nssfUpper,
    nssfRate:       doc.nssfRate  ?? DEFAULT_CONFIG.nssfRate,
    ahlRate:        doc.ahlRate   ?? DEFAULT_CONFIG.ahlRate,
  };
}

// ── PAYE ─────────────────────────────────────────────────────────────────────
export function computePAYE(grossSalary, cfg = DEFAULT_CONFIG) {
  const { personalRelief, payeBands } = cfg;
  let tax = 0;
  let remaining = Math.max(0, grossSalary);
  let prev = 0;
  for (const { upTo, rate } of payeBands) {
    const bandLimit = (upTo === null || upTo === undefined) ? Infinity : upTo;
    const taxable   = Math.min(remaining, bandLimit - prev);
    if (taxable <= 0) { prev = bandLimit; continue; }
    tax       += taxable * rate;
    remaining -= taxable;
    prev       = bandLimit;
    if (remaining <= 0) break;
  }
  return Math.max(0, Math.round(tax - personalRelief));
}

// ── SHA / NHIF ────────────────────────────────────────────────────────────────
export function computeNHIF(grossSalary, cfg = DEFAULT_CONFIG) {
  return Math.max(cfg.shaMin, Math.round(grossSalary * cfg.shaRate));
}

// ── NSSF (New Act) ────────────────────────────────────────────────────────────
export function computeNSSF(grossSalary, cfg = DEFAULT_CONFIG) {
  const { nssfLower, nssfUpper, nssfRate } = cfg;
  const tier1 = nssfLower * nssfRate;
  const tier2 = grossSalary > nssfLower
    ? (Math.min(grossSalary, nssfUpper) - nssfLower) * nssfRate
    : 0;
  return Math.round(tier1 + tier2);
}

// ── Affordable Housing Levy ───────────────────────────────────────────────────
export function computeAHL(grossSalary, cfg = DEFAULT_CONFIG) {
  return Math.round(grossSalary * cfg.ahlRate);
}

// ── All statutory deductions in one call ─────────────────────────────────────
export function computeStatutory(grossSalary, cfg = DEFAULT_CONFIG) {
  const gross = Math.max(0, grossSalary);
  const c     = cfg || DEFAULT_CONFIG;
  return {
    paye: computePAYE(gross, c),
    nhif: computeNHIF(gross, c),
    nssf: computeNSSF(gross, c),
    ahl:  computeAHL(gross, c),
  };
}
