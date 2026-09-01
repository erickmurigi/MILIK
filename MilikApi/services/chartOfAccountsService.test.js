// ensureSystemChartOfAccounts is the production code path that seeds a business's
// GL accounts (also exercised indirectly via test/factories.js's
// createTestChartOfAccounts). It has an in-memory TTL cache (ensureCache) plus an
// `upsert` bulkWrite — this test verifies both the cache-hit short-circuit and a
// `force: true` re-run are truly idempotent: no duplicate ChartOfAccount rows are
// ever created for the same business+code.
import { describe, it, expect } from "vitest";
import { ensureSystemChartOfAccounts } from "./chartOfAccountsService.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { createTestCompany } from "../test/factories.js";

const countAndDistinctCodes = async (businessId) => {
  const accounts = await ChartOfAccount.find({ business: businessId }).select("code").lean();
  const distinctCodes = new Set(accounts.map((a) => a.code));
  return { count: accounts.length, distinctCodeCount: distinctCodes.size };
};

describe("ensureSystemChartOfAccounts idempotency", () => {
  it("calling twice (cache-hit path) does not create duplicate accounts", async () => {
    const company = await createTestCompany();

    await ensureSystemChartOfAccounts(company._id);
    const first = await countAndDistinctCodes(company._id);
    expect(first.count).toBeGreaterThan(0);
    expect(first.distinctCodeCount).toBe(first.count); // no duplicate codes

    // Second call within the TTL window should hit the in-memory cache and
    // return early without touching the database at all.
    await ensureSystemChartOfAccounts(company._id);
    const second = await countAndDistinctCodes(company._id);
    expect(second.count).toBe(first.count);
    expect(second.distinctCodeCount).toBe(second.count);
  });

  it("force: true re-run (bypassing the cache) still upserts without duplicating rows", async () => {
    const company = await createTestCompany();

    await ensureSystemChartOfAccounts(company._id);
    const first = await countAndDistinctCodes(company._id);
    expect(first.count).toBeGreaterThan(0);

    // force:true skips the TTL cache short-circuit and runs the bulkWrite
    // upsert again — filter is {business, code} with upsert:true, so every
    // row should match an existing document rather than inserting a new one.
    await ensureSystemChartOfAccounts(company._id, { force: true });
    const second = await countAndDistinctCodes(company._id);
    expect(second.count).toBe(first.count);
    expect(second.distinctCodeCount).toBe(second.count);

    // Run force:true a second time for good measure — still stable.
    await ensureSystemChartOfAccounts(company._id, { force: true });
    const third = await countAndDistinctCodes(company._id);
    expect(third.count).toBe(first.count);
  });
});
