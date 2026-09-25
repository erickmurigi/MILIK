import { describe, it, expect } from "vitest";
import { WHT_MAX_RATE, calcWithholding, clampWhtRate } from "./withholdingTax.js";

describe("withholding tax rules", () => {
  it("keeps 0% as 0% and only falls back when there is no number", () => {
    expect(clampWhtRate(0)).toBe(0);
    expect(clampWhtRate("0")).toBe(0);
    expect(clampWhtRate(undefined, 5)).toBe(5);
    expect(clampWhtRate("", 5)).toBe(5);
    expect(clampWhtRate("abc", 5)).toBe(5);
    expect(clampWhtRate(-3)).toBe(0);
    expect(clampWhtRate(99)).toBe(WHT_MAX_RATE);
  });

  it("splits a gross amount into tax withheld and net payable, to the cent", () => {
    expect(calcWithholding(98000, 5)).toEqual({ whtRate: 5, whtAmount: 4900, netAmount: 93100 });
    expect(calcWithholding(1000.55, 5)).toEqual({ whtRate: 5, whtAmount: 50.03, netAmount: 950.52 });
    expect(calcWithholding(500, 0)).toEqual({ whtRate: 0, whtAmount: 0, netAmount: 500 });
  });
});
