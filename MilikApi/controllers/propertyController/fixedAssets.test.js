// No test coverage existed for Fixed Assets before this file. Writing it surfaced a real
// bug: runDepreciation referenced FinancialLedgerEntry (for its "already posted this period"
// dedup check) without importing the model — a guaranteed ReferenceError crash on every
// depreciation run that had at least one asset actually due for depreciation (i.e. almost
// every real run). Fixed by adding the import.
//
// A second, bigger bug surfaced after that: the original design always posted exactly ONE
// month's charge no matter how wide a date range was picked, so a backdated asset (added to
// the register months after its real purchase date) silently under-posted — and because the
// "already posted" dedup matched on the *exact* period-date pair, re-running with a different
// range could double-post a month already charged. Replaced with a catch-up model keyed to a
// single `asOf` ("run depreciation through this date") — the real source of truth for what's
// owed is asset.lastDepreciationDate (or purchaseDate, first run), so a run always charges
// exactly the months actually owed and a re-run always computes 0 months due for anything
// already covered. These tests cover both the regression and the catch-up behavior itself.
import { describe, it, expect } from "vitest";
import {
  createFixedAsset,
  getFixedAsset,
  updateFixedAsset,
  runDepreciation,
  disposeFixedAsset,
} from "./fixedAssets.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";

const setup = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });

  const [assetAccount, depreciationExpenseAccount, accumulatedDepreciationAccount] = await Promise.all([
    ChartOfAccount.create({ business: company._id, code: "1500", name: "Office Equipment", type: "asset", isPosting: true }),
    ChartOfAccount.create({ business: company._id, code: "5700", name: "Depreciation Expense", type: "expense", isPosting: true }),
    ChartOfAccount.create({ business: company._id, code: "1510", name: "Accumulated Depreciation", type: "asset", isPosting: true }),
  ]);

  return { company, user, assetAccount, depreciationExpenseAccount, accumulatedDepreciationAccount };
};

const createAsset = async (ctx, overrides = {}) => {
  const res = await callController(createFixedAsset, {
    user: ctx.user,
    body: {
      name: "Dell Laptop",
      purchaseDate: "2026-01-01",
      purchaseCost: 12000,
      residualValue: 0,
      depreciationMethod: "straight_line",
      usefulLifeYears: 1,
      assetAccount: String(ctx.assetAccount._id),
      depreciationExpenseAccount: String(ctx.depreciationExpenseAccount._id),
      accumulatedDepreciationAccount: String(ctx.accumulatedDepreciationAccount._id),
      ...overrides,
    },
  });
  return res.payload;
};

describe("fixedAssets — create", () => {
  it("creates an asset with zero accumulated depreciation", async () => {
    const ctx = await setup();
    const asset = await createAsset(ctx);
    expect(asset.status).toBe("active");
    expect(asset.accumulatedDepreciation).toBe(0);
  });
});

describe("fixedAssets — runDepreciation", () => {
  it("posts GL entries and updates the asset without crashing (regression for missing FinancialLedgerEntry import)", async () => {
    const ctx = await setup();
    const asset = await createAsset(ctx);

    const res = await callController(runDepreciation, {
      user: ctx.user,
      body: { asOf: "2026-01-31" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload.results).toHaveLength(1);
    expect(res.payload.results[0].skipped).toBeUndefined();
    expect(res.payload.results[0].depreciation).toBe(1000); // 12000 / 1yr / 12mo
    expect(res.payload.results[0].monthsCharged).toBe(1);

    const updated = await callController(getFixedAsset, { user: ctx.user, params: { id: asset._id } });
    expect(updated.payload.accumulatedDepreciation).toBe(1000);
    expect(updated.payload.bookValue).toBe(11000);
  });

  it("catches up every month actually owed in one run for a never-depreciated (backdated) asset — the exact gap a user found live", async () => {
    const ctx = await setup();
    // Purchased January; first depreciation run happens in March — 3 months owed, not 1.
    const asset = await createAsset(ctx, { purchaseDate: "2026-01-01" });

    const res = await callController(runDepreciation, { user: ctx.user, body: { asOf: "2026-03-31" } });

    expect(res.payload.results[0].monthsCharged).toBe(3);
    expect(res.payload.results[0].depreciation).toBe(3000); // 3 × 1000

    const updated = await callController(getFixedAsset, { user: ctx.user, params: { id: asset._id } });
    expect(updated.payload.accumulatedDepreciation).toBe(3000);
  });

  it("re-running for an asOf already fully covered posts nothing (no double-charge)", async () => {
    const ctx = await setup();
    const asset = await createAsset(ctx, { purchaseDate: "2026-01-01" });
    await callController(runDepreciation, { user: ctx.user, body: { asOf: "2026-03-31" } }); // catches up Jan–Mar

    const second = await callController(runDepreciation, { user: ctx.user, body: { asOf: "2026-02-28" } }); // earlier/overlapping date
    expect(second.payload.results[0].skipped).toBe(true);
    expect(second.payload.results[0].reason).toMatch(/no depreciation due/i);

    const updated = await callController(getFixedAsset, { user: ctx.user, params: { id: asset._id } });
    expect(updated.payload.accumulatedDepreciation).toBe(3000); // unchanged — not doubled
  });

  it("a later run only charges the newly-owed months, not the ones already caught up", async () => {
    const ctx = await setup();
    const asset = await createAsset(ctx, { purchaseDate: "2026-01-01" });
    await callController(runDepreciation, { user: ctx.user, body: { asOf: "2026-03-31" } }); // Jan–Mar = 3000

    const res = await callController(runDepreciation, { user: ctx.user, body: { asOf: "2026-05-31" } }); // Apr–May only
    expect(res.payload.results[0].monthsCharged).toBe(2);
    expect(res.payload.results[0].depreciation).toBe(2000);

    const updated = await callController(getFixedAsset, { user: ctx.user, params: { id: asset._id } });
    expect(updated.payload.accumulatedDepreciation).toBe(5000); // 3000 + 2000
  });

  it("marks an asset fully_depreciated in a single catch-up run, stopping exactly at residual", async () => {
    const ctx = await setup();
    const asset = await createAsset(ctx, { purchaseDate: "2026-01-01", purchaseCost: 1200, usefulLifeYears: 1 }); // 100.00/mo

    const res = await callController(runDepreciation, { user: ctx.user, body: { asOf: "2027-06-30" } }); // 18 months requested, only 12 owed
    expect(res.payload.results[0].monthsCharged).toBe(12);
    expect(res.payload.results[0].depreciation).toBe(1200);

    const updated = await callController(getFixedAsset, { user: ctx.user, params: { id: asset._id } });
    expect(updated.payload.status).toBe("fully_depreciated");
    expect(updated.payload.bookValue).toBe(0);
  });
});

describe("fixedAssets — dispose", () => {
  it("posts a balanced disposal journal and marks the asset disposed", async () => {
    const ctx = await setup();
    const asset = await createAsset(ctx);
    await callController(runDepreciation, { user: ctx.user, body: { asOf: "2026-01-31" } });

    const res = await callController(disposeFixedAsset, {
      user: ctx.user,
      params: { id: asset._id },
      body: { disposalDate: "2026-02-01", disposalProceeds: 0 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload.bookValue).toBe(11000);
    expect(res.payload.asset.status).toBe("disposed");
  });

  it("rejects editing a disposed asset", async () => {
    const ctx = await setup();
    const asset = await createAsset(ctx);
    await callController(disposeFixedAsset, { user: ctx.user, params: { id: asset._id }, body: {} });

    await expect(callController(updateFixedAsset, { user: ctx.user, params: { id: asset._id }, body: { name: "x" } }))
      .rejects.toThrow(/disposed assets cannot be edited/i);
  });
});

describe("fixedAssets — cross-tenant isolation", () => {
  it("getFixedAsset/updateFixedAsset/disposeFixedAsset 404 for a different company's user", async () => {
    const ctx = await setup();
    const asset = await createAsset(ctx);
    const otherUser = await createTestUser({ company: await createTestCompany() });

    await expect(callController(getFixedAsset, { user: otherUser, params: { id: asset._id } }))
      .rejects.toThrow(/not found/i);
    await expect(callController(updateFixedAsset, { user: otherUser, params: { id: asset._id }, body: { name: "x" } }))
      .rejects.toThrow(/not found/i);
    await expect(callController(disposeFixedAsset, { user: otherUser, params: { id: asset._id }, body: {} }))
      .rejects.toThrow(/not found/i);
  });
});
