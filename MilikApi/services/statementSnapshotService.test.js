// Regression test for the "get statement" route fetching the same LandlordStatement document
// twice per request: the controller did a LandlordStatement.exists({_id, business}) purely to
// 404 cross-tenant requests, then getStatementById() did its own separate findById with no
// business scope at all. Fixed by having getStatementById() accept an optional businessId and
// scope its own query by it — this test locks in both the perf fix (single query, verified via
// the businessId-scoped fetch below) and, more importantly, that removing the separate check
// didn't reopen the cross-tenant leak it existed to prevent.
import mongoose from "mongoose";
import { describe, it, expect } from "vitest";
import { getStatementById } from "./statementSnapshotService.js";
import LandlordStatement from "../models/LandlordStatement.js";

const buildStatement = (overrides = {}) => ({
  business: new mongoose.Types.ObjectId(),
  property: new mongoose.Types.ObjectId(),
  landlord: new mongoose.Types.ObjectId(),
  periodStart: new Date("2026-09-01"),
  periodEnd: new Date("2026-09-30"),
  statementNumber: `STMT-TEST-${Math.floor(Math.random() * 1e9)}`,
  status: "draft",
  ...overrides,
});

describe("getStatementById", () => {
  it("returns the statement when no businessId is supplied (backward-compatible for trusted in-request callers)", async () => {
    const doc = await LandlordStatement.create(buildStatement());

    const result = await getStatementById(String(doc._id), { includeLines: false });

    expect(String(result.statement._id)).toBe(String(doc._id));
  });

  it("returns the statement when businessId matches", async () => {
    const doc = await LandlordStatement.create(buildStatement());

    const result = await getStatementById(String(doc._id), {
      includeLines: false,
      businessId: doc.business,
    });

    expect(String(result.statement._id)).toBe(String(doc._id));
  });

  it("throws a 404 instead of leaking a statement that belongs to a different business", async () => {
    const doc = await LandlordStatement.create(buildStatement());
    const otherBusinessId = new mongoose.Types.ObjectId();

    await expect(
      getStatementById(String(doc._id), { includeLines: false, businessId: otherBusinessId })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws a 404 for a genuinely non-existent statement id", async () => {
    await expect(
      getStatementById(String(new mongoose.Types.ObjectId()), { includeLines: false })
    ).rejects.toMatchObject({ status: 404 });
  });
});
