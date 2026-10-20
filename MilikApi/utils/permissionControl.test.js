// Regression coverage for hasCompanyActionPermission — specifically the "explicit false must win over
// Full access" ordering bug found during a system-wide rights audit (an admin could grant moduleAccess
// "Full access" while explicitly denying one dangerous action, and that denial was silently ignored).
import { describe, it, expect } from "vitest";
import { hasCompanyActionPermission } from "./permissionControl.js";

const company = { _id: "biz1", modules: { accounts: true, propertySale: true } };

const makeUser = ({ moduleAccess, permissions = {}, adminAccess = false }) => ({
  company: "biz1",
  adminAccess,
  companyAssignments: [{ company: "biz1", moduleAccess, permissions }],
});

describe("hasCompanyActionPermission", () => {
  it("an explicit false denial wins over Full access moduleAccess", () => {
    const user = makeUser({
      moduleAccess: { accounts: "Full access" },
      permissions: { journals: { delete: false } },
    });
    expect(hasCompanyActionPermission({ user, company, moduleKey: "accounts", resource: "journals", action: "delete" })).toBe(false);
  });

  it("Full access still grants a permission nobody ever configured", () => {
    const user = makeUser({ moduleAccess: { accounts: "Full access" } });
    expect(hasCompanyActionPermission({ user, company, moduleKey: "accounts", resource: "journals", action: "delete" })).toBe(true);
  });

  it("an explicit true grant works even under View only moduleAccess", () => {
    const user = makeUser({
      moduleAccess: { propertySale: "View only" },
      permissions: { "sale-deals": { create: true } },
    });
    expect(hasCompanyActionPermission({ user, company, moduleKey: "propertySale", resource: "sale-deals", action: "create" })).toBe(true);
  });

  it("View only grants view but denies create", () => {
    const user = makeUser({ moduleAccess: { propertySale: "View only" } });
    expect(hasCompanyActionPermission({ user, company, moduleKey: "propertySale", resource: "sale-deals", action: "view" })).toBe(true);
    expect(hasCompanyActionPermission({ user, company, moduleKey: "propertySale", resource: "sale-deals", action: "create" })).toBe(false);
  });

  it("Not allowed denies everything not explicitly granted", () => {
    const user = makeUser({ moduleAccess: { propertySale: "Not allowed" } });
    expect(hasCompanyActionPermission({ user, company, moduleKey: "propertySale", resource: "sale-deals", action: "view" })).toBe(false);
  });

  it("an explicit false denial wins even under View only for an otherwise-view-allowed action", () => {
    const user = makeUser({
      moduleAccess: { propertySale: "View only" },
      permissions: { "sale-commissions": { view: false } },
    });
    expect(hasCompanyActionPermission({ user, company, moduleKey: "propertySale", resource: "sale-commissions", action: "view" })).toBe(false);
  });

  it("the module-enabled floor still blocks everything, including an explicit true grant, when the module is disabled for the company", () => {
    const disabledCompany = { _id: "biz1", modules: { propertySale: false } };
    const user = makeUser({
      moduleAccess: { propertySale: "View only" },
      permissions: { "sale-deals": { view: true } },
    });
    expect(hasCompanyActionPermission({ user, company: disabledCompany, moduleKey: "propertySale", resource: "sale-deals", action: "view" })).toBe(false);
  });

  it("the module-enabled floor still blocks when moduleAccess is Not allowed, even with an explicit true grant", () => {
    const user = makeUser({
      moduleAccess: { propertySale: "Not allowed" },
      permissions: { "sale-deals": { view: true } },
    });
    expect(hasCompanyActionPermission({ user, company, moduleKey: "propertySale", resource: "sale-deals", action: "view" })).toBe(false);
  });
});
