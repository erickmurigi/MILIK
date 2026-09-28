// The settings pages ask for several things at once. For a company whose settings document does not exist yet, every one of those
// requests must be answered (before, all but one failed with a 500 and the page showed "Internal server error").
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestUser } from "../../test/factories.js";
import CompanySettings from "../../models/CompanySettings.js";
import { getCompanySettings } from "./companySettings.js";

describe("company settings created on first use", () => {
  it("answers every one of several simultaneous reads, and creates a single document", async () => {
    const company = await createTestCompany();
    const user = await createTestUser({ company });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => callController(getCompanySettings, { user })));
    expect(results.filter((r) => r.status !== "fulfilled").map((r) => String(r.reason?.message || r.reason))).toEqual([]);
    expect(results.every((r) => r.value.statusCode === 200)).toBe(true);
    expect(await CompanySettings.countDocuments({ company: company._id })).toBe(1);
  }, 60_000);
});
