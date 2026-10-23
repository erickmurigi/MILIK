// Settings > Car Wash > Accounting Defaults — lets a business redirect any of resolveCarWashAccount's
// fixed codes to its own ChartOfAccount numbering instead of the auto-created system default. Mirrors
// modules/propertySale/controllers/accountingDefaults.test.js's coverage exactly for this module.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { listCarWashAccountingDefaultTemplates, updateCarWashAccountingDefaults } from "./settingsController.js";
import { resolveCarWashAccount } from "../services/carwashAccountingService.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { carwash: true, accounts: true } });
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  return { business, call };
};

describe("listCarWashAccountingDefaultTemplates", () => {
  it("returns every code from the registry resolveCarWashAccount uses", async () => {
    const { call } = await setup();
    const res = await call(listCarWashAccountingDefaultTemplates, {});
    expect(res.statusCode).toBe(200);
    const codes = res.payload.templates.map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(["4400", "5310", "2160", "2161", "4401", "2162", "4402"]));
    const serviceIncome = res.payload.templates.find((t) => t.code === "4400");
    expect(serviceIncome).toMatchObject({ name: "Car Wash Service Income", type: "income" });
  });
});

describe("updateCarWashAccountingDefaults", () => {
  it("rejects an override of the wrong account type", async () => {
    const { business, call } = await setup();
    const liabilityAcc = await ChartOfAccount.create({ business, code: "9001", name: "Some Liability", type: "liability", isPosting: true });

    // This controller rejects via next({status, message}), not an Error instance — assert on the
    // rejected value's shape directly rather than .rejects.toThrow (which expects a real Error).
    await expect(
      call(updateCarWashAccountingDefaults, { body: { accountingDefaults: { "4400": String(liabilityAcc._id) } } })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/invalid|wrong account type/i) });
  });

  it("saves a valid override and resolveCarWashAccount uses it instead of auto-creating the system default", async () => {
    const { business, call } = await setup();
    const customIncomeAcc = await ChartOfAccount.create({ business, code: "9100", name: "Custom Car Wash Income", type: "income", isPosting: true });

    const res = await call(updateCarWashAccountingDefaults, { body: { accountingDefaults: { "4400": String(customIncomeAcc._id) } } });
    expect(res.statusCode).toBe(200);

    const resolved = await resolveCarWashAccount(business, "4400");
    expect(String(resolved._id)).toBe(String(customIncomeAcc._id));

    const systemDefault = await ChartOfAccount.findOne({ business, code: "4400" }).lean();
    expect(systemDefault).toBeNull();
  });

  it("takes effect immediately even if resolveCarWashAccount already cached the system default for this code", async () => {
    const { business, call } = await setup();

    const before = await resolveCarWashAccount(business, "5310");
    const systemDefault = await ChartOfAccount.findOne({ business, code: "5310" }).lean();
    expect(String(before._id)).toBe(String(systemDefault._id));

    const customExpense = await ChartOfAccount.create({ business, code: "9200", name: "Custom Supplies Expense", type: "expense", isPosting: true });
    await call(updateCarWashAccountingDefaults, { body: { accountingDefaults: { "5310": String(customExpense._id) } } });

    const after = await resolveCarWashAccount(business, "5310");
    expect(String(after._id)).toBe(String(customExpense._id));
  });

  it("clearing an override (empty string) reverts to the system default", async () => {
    const { business, call } = await setup();
    const customIncomeAcc = await ChartOfAccount.create({ business, code: "9100", name: "Custom Income", type: "income", isPosting: true });
    await call(updateCarWashAccountingDefaults, { body: { accountingDefaults: { "4400": String(customIncomeAcc._id) } } });

    await call(updateCarWashAccountingDefaults, { body: { accountingDefaults: { "4400": "" } } });
    const resolved = await resolveCarWashAccount(business, "4400");
    expect(String(resolved._id)).not.toBe(String(customIncomeAcc._id));
    const systemDefault = await ChartOfAccount.findOne({ business, code: "4400" }).lean();
    expect(String(resolved._id)).toBe(String(systemDefault._id));
  });
});
