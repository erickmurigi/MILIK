// Pure arithmetic behind contract billing: tax per line, contract value metrics and schedule
// generation (advance/arrears, billing-day stubs, daily proration, termination cut-off).
import { describe, it, expect } from "vitest";
import {
  allocateAcrossMonths,
  buildContractSchedule,
  calculateLineAmounts,
  computeContractMetrics,
  effectiveContractLines,
  monthsBetweenInclusive,
} from "./clientLineMath.js";

const d = (s) => new Date(`${s}T00:00:00.000Z`);
const day = (date) => date.toISOString().slice(0, 10);

describe("calculateLineAmounts", () => {
  it("exclusive VAT after discount", () => {
    const r = calculateLineAmounts({ quantity: 2, unitPrice: 1000, discountPercent: 10, taxRate: 16, taxType: "vat", taxMode: "exclusive" });
    expect(r).toMatchObject({ grossBeforeDiscount: 2000, discountAmount: 200, netAmount: 1800, taxAmount: 288, totalAmount: 2088 });
  });

  it("inclusive VAT backs the tax out of the price", () => {
    const r = calculateLineAmounts({ quantity: 1, unitPrice: 1160, taxRate: 16, taxType: "vat", taxMode: "inclusive" });
    expect(r).toMatchObject({ netAmount: 1000, taxAmount: 160, totalAmount: 1160 });
  });

  it("exempt / zero-rated lines carry no tax whatever the rate", () => {
    expect(calculateLineAmounts({ quantity: 1, unitPrice: 500, taxRate: 16, taxType: "exempt" }).taxAmount).toBe(0);
    expect(calculateLineAmounts({ quantity: 1, unitPrice: 500, taxRate: 0, taxType: "zero_rated" }).totalAmount).toBe(500);
  });
});

describe("contract metrics", () => {
  it("derives MRR / ACV / TCV from mixed-frequency lines, net of tax", () => {
    const contract = {
      startDate: d("2026-01-01"),
      endDate: d("2027-12-31"),
      lines: [
        { itemName: "Retainer", quantity: 1, unitPrice: 10000, billingFrequency: "monthly", taxType: "vat", taxRate: 16 },
        { itemName: "Audit", quantity: 1, unitPrice: 30000, billingFrequency: "quarterly", discountPercent: 10 },
        { itemName: "Setup", quantity: 1, unitPrice: 50000, billingFrequency: "one_off" },
      ],
    };
    const m = computeContractMetrics(contract);
    // 10,000 + 27,000/3 = 19,000 per month; 24 months -> 456,000 + 50,000 setup
    expect(m.mrr).toBe(19000);
    expect(m.termMonths).toBe(24);
    expect(m.tcv).toBe(506000);
    expect(m.acv).toBe(253000);
  });

  it("treats a pre-lines contract as one line of currentValue on its billing cycle", () => {
    const lines = effectiveContractLines({ currentValue: 25000, billingCycle: "monthly", description: "Old retainer" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineKey: "legacy", unitPrice: 25000, billingFrequency: "monthly" });
    expect(computeContractMetrics({ currentValue: 25000, startDate: d("2026-01-01"), endDate: d("2026-12-31") }).tcv).toBe(300000);
  });

  it("counts whole calendar months inclusively", () => {
    expect(monthsBetweenInclusive(d("2026-01-01"), d("2026-12-31"))).toBe(12);
    expect(monthsBetweenInclusive(d("2026-01-15"), d("2026-02-14"))).toBe(1);
  });
});

describe("buildContractSchedule", () => {
  const base = { _id: "c1", startDate: d("2026-01-10"), endDate: d("2026-04-30"), openEnded: false };
  const line = { lineKey: "L1", itemName: "Support", quantity: 1, unitPrice: 3100, billingFrequency: "monthly" };

  it("anchors on the start date with no billing day (advance bills on the period start)", () => {
    const rows = buildContractSchedule({ contract: { ...base, endDate: d("2026-04-09") }, versions: null });
    const rowsWithLine = buildContractSchedule({ contract: { ...base, endDate: d("2026-04-09"), lines: [line] } });
    expect(rows).toHaveLength(0); // no lines, no value
    expect(rowsWithLine.map((r) => [day(r.from), day(r.to), day(r.billingDate)])).toEqual([
      ["2026-01-10", "2026-02-09", "2026-01-10"],
      ["2026-02-10", "2026-03-09", "2026-02-10"],
      ["2026-03-10", "2026-04-09", "2026-03-10"],
    ]);
    expect(rowsWithLine[0].idempotencyKey).toBe("client_billing:c1:L1:monthly:2026-01-10");
  });

  it("billing day + daily proration gives a prorated stub, full months, and a prorated tail", () => {
    const rows = buildContractSchedule({ contract: { ...base, billingDay: 1, prorationRule: "daily", lines: [line] } });
    expect(rows.map((r) => [day(r.from), day(r.to)])).toEqual([
      ["2026-01-10", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-31"],
      ["2026-04-01", "2026-04-30"],
    ]);
    expect(rows[0].prorationFactor).toBeCloseTo(22 / 31, 6);
    expect(rows[1].prorationFactor).toBe(1);
    // Without daily proration the stub is billed in full.
    const flat = buildContractSchedule({ contract: { ...base, billingDay: 1, prorationRule: "none", lines: [line] } });
    expect(flat[0].prorationFactor).toBe(1);
  });

  it("arrears bills on the last day of each period", () => {
    const rows = buildContractSchedule({ contract: { ...base, billingDay: 1, lines: [{ ...line, billingTiming: "arrears" }] } });
    expect(rows.map((r) => day(r.billingDate))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("termination stops later periods and prorates the one it cuts", () => {
    const rows = buildContractSchedule({
      contract: { ...base, startDate: d("2026-01-01"), billingDay: 1, prorationRule: "daily", terminationEffectiveDate: d("2026-03-16"), lines: [line] },
    });
    expect(rows.map((r) => [day(r.from), day(r.to)])).toEqual([
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-15"],
    ]);
    expect(rows[2].prorationFactor).toBeCloseTo(15 / 31, 6);
  });

  it("prices each period from the version in force on its first day", () => {
    const contract = { ...base, startDate: d("2026-01-01"), endDate: d("2026-03-31"), billingDay: 1, lines: [line] };
    const versions = [
      { version: 1, effectiveDate: d("2026-01-01"), lines: [line] },
      { version: 2, effectiveDate: d("2026-03-01"), lines: [{ ...line, unitPrice: 3410 }] },
    ];
    const rows = buildContractSchedule({ contract, versions });
    expect(rows.map((r) => [r.unitPrice, r.contractVersion])).toEqual([[3100, 1], [3100, 1], [3410, 2]]);
  });

  it("open-ended contracts stop at the horizon", () => {
    const rows = buildContractSchedule({ contract: { ...base, openEnded: true, endDate: null, lines: [line] }, horizonEnd: d("2026-06-30") });
    expect(rows).toHaveLength(6);
  });
});

describe("allocateAcrossMonths", () => {
  it("splits by days and puts the rounding remainder on the last month", () => {
    const parts = allocateAcrossMonths({ amount: 1000, from: d("2026-01-16"), to: d("2026-03-15") });
    expect(parts.map((p) => p.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(1000, 2);
    expect(parts[0].amount).toBeCloseTo((1000 * 16) / 59, 1);
  });
});
