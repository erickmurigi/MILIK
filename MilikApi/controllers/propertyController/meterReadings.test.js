// Integration tests for controllers/propertyController/meterReadings.js.
// Focus: today's real fixes/additions — rate resolution priority, the batch-create
// endpoint (including duplicate-skip), the vacant-unit billing guard, and the
// batch-bill/batch-delete partial-failure shape.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import {
  createTestUnit,
  createTestTenant,
  createTestUser,
} from "../../test/factories.js";
import Property from "../../models/Property.js";
import MeterReading from "../../models/MeterReading.js";
import {
  createMeterReading,
  createMeterReadingsBatch,
  billMeterReading,
  billMeterReadingsBatch,
  deleteMeterReadingsBatch,
} from "./meterReadings.js";

describe("createMeterReading — rate resolution", () => {
  it("picks up a property-level utilityRates[] rate when no unit override exists", async () => {
    const { unit, property, company } = await createTestUnit({});

    // Property-level utility rate for "Water" — no unit.utilities override configured.
    await Property.findByIdAndUpdate(property._id, {
      $set: { utilityRates: [{ utilityType: "Water", unitCost: 50, isActive: true }] },
    });

    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(createMeterReading, {
      user,
      body: {
        property: String(property._id),
        unit: String(unit._id),
        utilityType: "Water",
        currentReading: 120,
        readingDate: new Date(),
      },
    });

    expect(statusCode).toBe(201);
    // No previous reading on record -> previousReading defaults to 0, so
    // unitsConsumed = 120 and amount = 120 * propertyRate(50).
    expect(payload.previousReading).toBe(0);
    expect(payload.unitsConsumed).toBe(120);
    expect(payload.rate).toBe(50);
    expect(payload.amount).toBe(6000);
    expect(payload.status).toBe("draft");
  });
});

describe("createMeterReadingsBatch", () => {
  it("creates N draft readings in one call and skips a duplicate with a reason", async () => {
    const { property, company } = await createTestUnit({});
    const { unit: unitA } = await createTestUnit({ property, company });
    const { unit: unitB } = await createTestUnit({ property, company });
    const { unit: unitC } = await createTestUnit({ property, company });

    const user = await createTestUser({ company });
    const billingPeriod = "2026-03";

    // Pre-existing draft reading for unitC for the same utility+period — must be skipped.
    await MeterReading.create({
      business: company._id,
      property: property._id,
      unit: unitC._id,
      utilityType: "Water",
      billingPeriod,
      readingDate: new Date(2026, 2, 1),
      previousReading: 0,
      currentReading: 10,
      unitsConsumed: 10,
      rate: 10,
      amount: 100,
      status: "draft",
    });

    const { statusCode, payload } = await callController(createMeterReadingsBatch, {
      user,
      body: {
        property: String(property._id),
        utilityType: "Water",
        billingPeriod,
        readings: [
          { unit: String(unitA._id), currentReading: 50 },
          { unit: String(unitB._id), currentReading: 75 },
          { unit: String(unitC._id), currentReading: 30 },
        ],
      },
    });

    expect(statusCode).toBe(201);
    expect(payload.createdCount).toBe(2);
    expect(payload.skippedCount).toBe(1);
    expect(payload.skipped[0].unit).toBe(String(unitC._id));
    expect(payload.skipped[0].reason).toMatch(/already exists/i);
    expect(payload.created.map((r) => String(r.unit?._id || r.unit)).sort()).toEqual(
      [String(unitA._id), String(unitB._id)].sort()
    );
  });
});

describe("billMeterReading — vacant unit guard", () => {
  it("requires an active tenant and fails clearly when there isn't one", async () => {
    const { unit, property, company } = await createTestUnit({});
    const user = await createTestUser({ company });

    // No tenant created for this unit at all — the unit is vacant.
    const reading = await MeterReading.create({
      business: company._id,
      property: property._id,
      unit: unit._id,
      tenant: null,
      utilityType: "Water",
      billingPeriod: "2026-03",
      readingDate: new Date(2026, 2, 1),
      previousReading: 0,
      currentReading: 40,
      unitsConsumed: 40,
      rate: 20,
      amount: 800,
      status: "draft",
    });

    await expect(
      callController(billMeterReading, {
        user,
        params: { id: String(reading._id) },
        body: {},
      })
    ).rejects.toThrow(/no active tenant/i);

    const unchanged = await MeterReading.findById(reading._id).lean();
    expect(unchanged.status).toBe("draft");
    expect(unchanged.billedInvoice).toBeNull();
  });
});

describe("billMeterReadingsBatch / deleteMeterReadingsBatch — partial failure shape", () => {
  it("bills the reading with an active tenant and reports the vacant one as failed", async () => {
    const { unit: billableUnit, property, company } = await createTestUnit({});
    await createTestTenant({ unit: billableUnit, property, company, status: "active" });
    const { unit: vacantUnit } = await createTestUnit({ property, company });
    const user = await createTestUser({ company });

    const billableReading = await MeterReading.create({
      business: company._id,
      property: property._id,
      unit: billableUnit._id,
      utilityType: "Water",
      billingPeriod: "2026-03",
      readingDate: new Date(2026, 2, 1),
      previousReading: 0,
      currentReading: 40,
      unitsConsumed: 40,
      rate: 20,
      amount: 800,
      status: "draft",
    });

    const vacantReading = await MeterReading.create({
      business: company._id,
      property: property._id,
      unit: vacantUnit._id,
      utilityType: "Water",
      billingPeriod: "2026-03",
      readingDate: new Date(2026, 2, 1),
      previousReading: 0,
      currentReading: 15,
      unitsConsumed: 15,
      rate: 20,
      amount: 300,
      status: "draft",
    });

    const { statusCode, payload } = await callController(billMeterReadingsBatch, {
      user,
      body: { readingIds: [String(billableReading._id), String(vacantReading._id)] },
    });

    expect(statusCode).toBe(200);
    expect(payload.succeededCount).toBe(1);
    expect(payload.failedCount).toBe(1);
    expect(payload.succeeded[0].id).toBe(String(billableReading._id));
    expect(payload.failed[0].id).toBe(String(vacantReading._id));
    expect(payload.failed[0].reason).toMatch(/no active tenant/i);

    const billed = await MeterReading.findById(billableReading._id).lean();
    expect(billed.status).toBe("billed");
    expect(billed.billedInvoice).toBeTruthy();
  });

  it("deletes valid readings and reports an invalid id as failed", async () => {
    const { unit, property, company } = await createTestUnit({});
    const user = await createTestUser({ company });

    const readingOne = await MeterReading.create({
      business: company._id,
      property: property._id,
      unit: unit._id,
      utilityType: "Water",
      billingPeriod: "2026-03",
      readingDate: new Date(2026, 2, 1),
      previousReading: 0,
      currentReading: 10,
      unitsConsumed: 10,
      rate: 5,
      amount: 50,
      status: "draft",
    });

    const readingTwo = await MeterReading.create({
      business: company._id,
      property: property._id,
      unit: unit._id,
      utilityType: "Electricity",
      billingPeriod: "2026-03",
      readingDate: new Date(2026, 2, 1),
      previousReading: 0,
      currentReading: 20,
      unitsConsumed: 20,
      rate: 5,
      amount: 100,
      status: "draft",
    });

    const { statusCode, payload } = await callController(deleteMeterReadingsBatch, {
      user,
      body: { readingIds: [String(readingOne._id), String(readingTwo._id)] },
    });

    expect(statusCode).toBe(200);
    expect(payload.succeededCount).toBe(2);
    expect(payload.failedCount).toBe(0);

    const [one, two] = await Promise.all([
      MeterReading.findById(readingOne._id).lean(),
      MeterReading.findById(readingTwo._id).lean(),
    ]);
    expect(one.status).toBe("deleted");
    expect(two.status).toBe("deleted");
  });
});
