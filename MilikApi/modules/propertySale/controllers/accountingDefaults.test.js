// Settings > Property Sales > Accounting Defaults — lets a business redirect any of resolvePSAccount's
// fixed codes to its own ChartOfAccount numbering instead of the auto-created system default.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { listAccountingDefaultTemplates, updatePSAccountingDefaults } from "./settingsController.js";
import { resolvePSAccount } from "../services/propertySaleAccountingService.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  return { business, call, company };
};

describe("listAccountingDefaultTemplates", () => {
  it("returns every code from the registry resolvePSAccount uses, including the newly added 2186", async () => {
    const { call } = await setup();
    const res = await call(listAccountingDefaultTemplates, {});
    expect(res.statusCode).toBe(200);
    const codes = res.payload.templates.map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(["1311", "2150", "2180", "4410", "4420", "4430", "2186", "1314"]));
    const commissionIncome = res.payload.templates.find((t) => t.code === "4430");
    expect(commissionIncome).toMatchObject({ name: "Commission Income — Agency Fees", type: "income" });
  });
});

describe("updatePSAccountingDefaults", () => {
  it("rejects an override of the wrong account type", async () => {
    const { business, call } = await setup();
    const liabilityAcc = await ChartOfAccount.create({ business, code: "9001", name: "Some Liability", type: "liability", isPosting: true });

    await expect(
      call(updatePSAccountingDefaults, { body: { accountingDefaults: { "4430": String(liabilityAcc._id) } } })
    ).rejects.toThrow(/invalid|wrong account type/i);
  });

  it("saves a valid override and resolvePSAccount uses it instead of auto-creating the system default", async () => {
    const { business, call } = await setup();
    const customIncomeAcc = await ChartOfAccount.create({ business, code: "9100", name: "Custom Agency Commission Income", type: "income", isPosting: true });

    const res = await call(updatePSAccountingDefaults, { body: { accountingDefaults: { "4430": String(customIncomeAcc._id) } } });
    expect(res.statusCode).toBe(200);
    expect(String(res.payload.settings.accountingDefaults.get("4430"))).toBe(String(customIncomeAcc._id));

    const resolved = await resolvePSAccount(business, "4430");
    expect(String(resolved._id)).toBe(String(customIncomeAcc._id));

    // The system default (code "4430") must never have been auto-created at all.
    const systemDefault = await ChartOfAccount.findOne({ business, code: "4430" }).lean();
    expect(systemDefault).toBeNull();
  });

  it("takes effect immediately even if resolvePSAccount already cached the system default for this code", async () => {
    const { business, call } = await setup();

    // Resolve once first — this auto-creates and caches the system-default 1311 account.
    const before = await resolvePSAccount(business, "1311");
    const systemDefault = await ChartOfAccount.findOne({ business, code: "1311" }).lean();
    expect(String(before._id)).toBe(String(systemDefault._id));

    const customAsset = await ChartOfAccount.create({ business, code: "9200", name: "Custom Receipts Control", type: "asset", isPosting: true });
    await call(updatePSAccountingDefaults, { body: { accountingDefaults: { "1311": String(customAsset._id) } } });

    const after = await resolvePSAccount(business, "1311");
    expect(String(after._id)).toBe(String(customAsset._id));
  });

  it("clearing an override (empty string) reverts to the system default", async () => {
    const { business, call } = await setup();
    const customIncomeAcc = await ChartOfAccount.create({ business, code: "9100", name: "Custom Income", type: "income", isPosting: true });
    await call(updatePSAccountingDefaults, { body: { accountingDefaults: { "4430": String(customIncomeAcc._id) } } });

    await call(updatePSAccountingDefaults, { body: { accountingDefaults: { "4430": "" } } });
    const resolved = await resolvePSAccount(business, "4430");
    expect(String(resolved._id)).not.toBe(String(customIncomeAcc._id));
    const systemDefault = await ChartOfAccount.findOne({ business, code: "4430" }).lean();
    expect(String(resolved._id)).toBe(String(systemDefault._id));
  });
});
