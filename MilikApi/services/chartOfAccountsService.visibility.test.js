// A manually added account must always be visible to the company that added it.
import { describe, it, expect } from "vitest";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { createTestCompany } from "../test/factories.js";
import { defaultScopesForNewAccount, findChartOfAccounts, getCompanyActiveScopes } from "./chartOfAccountsService.js";

// A Property Sales company: no Property Management, Inventory, Clients, HR or Car Wash module
const salesOnlyCompany = () => createTestCompany({ modules: { propertyManagement: false, propertySale: true, accounts: true } });

// Same steps as POST /chart-of-accounts with no explicit module choice
const addLikeTheRoute = async (business, account) => {
  const active = await getCompanyActiveScopes(business);
  return ChartOfAccount.create({
    business, isSystem: false, isPosting: true, balance: 0, level: 0,
    ...account,
    moduleScopes: defaultScopesForNewAccount(account, active),
  });
};

const liability = (code, name, subGroup) => ({ code, name, type: "liability", group: "liabilities", subGroup });

describe("chart of accounts visibility", () => {
  it("shows a liability just added in a Property Sales company, whatever class or name it has", async () => {
    const business = (await salesOnlyCompany())._id;
    const cases = [
      liability("2900", "Deposits Held", "Current Liabilities"),
      liability("2901", "Supplier Balances", "Payables"),
      liability("2902", "VAT Suspense", "Tax Liabilities"),
      liability("2903", "Client Deposits", "Current Liabilities"), // "client" used to assign a scope the model rejected
      liability("2904", "PAYE Control", "Other Liabilities"),
      liability("2905", "Staff Loans Payable", "Long-term Liabilities"),
    ];
    for (const c of cases) await addLikeTheRoute(business, c);

    const listed = new Set((await findChartOfAccounts({ businessId: business })).map((a) => a.code));
    expect(cases.filter((c) => !listed.has(c.code)).map((c) => `${c.code} ${c.name} [${c.subGroup}]`)).toEqual([]);
  });

  it("keeps a module-specific tag when the company has that module", async () => {
    const company = await createTestCompany({ modules: { propertyManagement: true, propertySale: true, accounts: true } });
    const active = await getCompanyActiveScopes(company._id);
    // a plain account still follows the guess (Property Management here); a sale-class one follows the sales guess
    expect(defaultScopesForNewAccount({ code: "2950", name: "Owner Float", subGroup: "Current Liabilities" }, active)).toEqual(["propertyManagement"]);
    expect(defaultScopesForNewAccount({ code: "2951", name: "Sale Escrow", subGroup: "Sale Liabilities" }, active)).toEqual(["propertySale"]);
    // but a guess the company cannot see falls back to "general"
    expect(defaultScopesForNewAccount({ code: "2950", name: "Owner Float", subGroup: "Current Liabilities" }, ["general", "propertySale"])).toEqual(["general"]);
  });

  it("also lists accounts that were already created with a hidden tag (added before this fix)", async () => {
    const business = (await salesOnlyCompany())._id;
    await ChartOfAccount.create({
      business, isSystem: false, isPosting: true, balance: 0, level: 0,
      ...liability("2960", "Old Hidden Account", "Current Liabilities"),
      moduleScopes: ["propertyManagement"], // what the old code stored for a company without that module
    });
    const listed = (await findChartOfAccounts({ businessId: business })).map((a) => a.code);
    expect(listed).toContain("2960");
  });

  it("still filters strictly when a module filter is chosen", async () => {
    const business = (await salesOnlyCompany())._id;
    await ChartOfAccount.create({
      business, isSystem: false, isPosting: true, balance: 0, level: 0,
      ...liability("2970", "PM Only Account", "Current Liabilities"),
      moduleScopes: ["propertyManagement"],
    });
    const codes = (await findChartOfAccounts({ businessId: business, moduleScope: "propertySale" })).map((a) => a.code);
    expect(codes).not.toContain("2970");
  });
});
