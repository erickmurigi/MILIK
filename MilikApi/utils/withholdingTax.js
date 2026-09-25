import { round2 } from "./math.js";

// One place for the withholding tax (WHT) rules, so service providers, payment vouchers and sales commissions agree.
export const WHT_MAX_RATE = 30;

/** A rate as a number between 0 and WHT_MAX_RATE. Anything that isn't a number becomes `fallback`. 0 stays 0. */
export const clampWhtRate = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const rate = Number(value);
  return Number.isFinite(rate) ? Math.min(WHT_MAX_RATE, Math.max(0, rate)) : fallback;
};

/** Tax withheld from `gross` at `rate` percent, and what is left to pay. */
export const calcWithholding = (gross, rate) => {
  const grossAmount = round2(gross);
  const whtRate = clampWhtRate(rate);
  const whtAmount = round2((grossAmount * whtRate) / 100);
  return { whtRate, whtAmount, netAmount: round2(grossAmount - whtAmount) };
};
