// Explicit "pay the recharge" flow: an advocate sees their owners' outstanding recoverable-expense
// vouchers and deliberately remits cash to settle one or more of them, posting a direct Dr cashbook /
// Cr 1313 Owner Expense Recoverable settlement.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createPaymentVoucher } from "../../../controllers/propertyController/paymentVoucher.js";
import {
  createRechargeRemittance, listOutstandingRecharges, listRechargeRemittances, voidRechargeRemittance,
} from "./rechargeRemittancesController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const staffUser = await createTestUser({ company });
  const business = company._id;
  const staffCall = (fn, opts = {}) => callController(fn, { user: staffUser, ...opts });

  const advocate = await SaleAdvocate.create({ business, advocateNumber: `ADV-${++seq}`, fullName: "John Advocate", phone: `0733${seq}` });
  const owner = await SaleOwner.create({ business, ownerNumber: `OWN-${++seq}`, fullName: "Jane Owner", phone: `0722${seq}` });
  await SaleProject.create({ business, projectNumber: `PRJ-${seq}`, name: `Estate ${seq}`, owner: owner._id, assignedAdvocate: advocate._id });

  const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
  await SaleAdvocate.updateOne({ _id: advocate._id }, { userIds: [advocateUser._id] });
  const asAdvocate = (fn, opts = {}) => callController(fn, { user: advocateUser, saleAdvocateId: String(advocate._id), ...opts });

  const liabilityAccount = await getAccountByCode(business, "2120");
  const makeVoucher = async (amount, dueDate) =>
    (await staffCall(createPaymentVoucher, {
      body: { category: "sale_owner_expense", saleOwner: String(owner._id), liabilityAccount: String(liabilityAccount._id), amount, dueDate, status: "approved" },
    })).payload;

  return { business, staffCall, asAdvocate, advocate, owner, makeVoucher };
};

describe("recharge remittance — outstanding list", () => {
  it("an advocate sees only their own owners' outstanding vouchers, oldest-due-first", async () => {
    const { asAdvocate, owner, makeVoucher } = await setup();
    const older = await makeVoucher(5_000, "2026-01-01");
    const newer = await makeVoucher(8_000, "2026-02-01");

    const res = await asAdvocate(listOutstandingRecharges, {});
    expect(res.payload.data.map((v) => String(v.voucherId))).toEqual([String(older._id), String(newer._id)]);
    expect(res.payload.data[0]).toMatchObject({ outstanding: 5_000, owner: { ownerNumber: owner.ownerNumber } });
  });

  it("a staff caller can see a specific advocate's outstanding vouchers by ?advocate= — mirrors the advocate's own scoped view", async () => {
    const { business, staffCall, advocate, owner, makeVoucher } = await setup();
    const voucher = await makeVoucher(5_000, "2026-01-01");
    const otherOwner = await SaleOwner.create({ business, ownerNumber: `OWN-STAFFVIEW-${++seq}`, fullName: "Unrelated Owner", phone: `0705${seq}` });
    const liabilityAccount = await getAccountByCode(business, "2120");
    await staffCall(createPaymentVoucher, {
      body: { category: "sale_owner_expense", saleOwner: String(otherOwner._id), liabilityAccount: String(liabilityAccount._id), amount: 9_000, dueDate: "2026-01-01", status: "approved" },
    });

    const res = await staffCall(listOutstandingRecharges, { query: { advocate: String(advocate._id) } });
    expect(res.payload.data.map((v) => String(v.voucherId))).toEqual([String(voucher._id)]);
    expect(res.payload.data[0]).toMatchObject({ owner: { ownerNumber: owner.ownerNumber } });
  });

  it("an advocate never sees another owner's outstanding voucher", async () => {
    const { business, staffCall, asAdvocate } = await setup();
    const otherOwner = await SaleOwner.create({ business, ownerNumber: `OWN-X-${++seq}`, fullName: "Other Owner", phone: `0700${seq}` });
    const liabilityAccount = await getAccountByCode(business, "2120");
    await staffCall(createPaymentVoucher, {
      body: { category: "sale_owner_expense", saleOwner: String(otherOwner._id), liabilityAccount: String(liabilityAccount._id), amount: 9_000, dueDate: "2026-01-01", status: "approved" },
    });

    const res = await asAdvocate(listOutstandingRecharges, {});
    expect(res.payload.data).toEqual([]);
  });
});

describe("recharge remittance — owner-centric scoping (one owner, several projects, different advocates)", () => {
  // Visibility is deliberately OWNER-centric, not project-centric: an advocate linked to even one of an
  // owner's projects is treated as the firm handling that owner's whole relationship with the company,
  // so they see (and can remit) every recharge for that owner regardless of which project it's tagged
  // to. This is a visibility/attribution concern, not a custody-of-funds one — trust money stays
  // strictly scoped to whichever advocate actually collected it (see advocateTrust.test.js), but an
  // expense the company is owed isn't anyone's private money to begin with.
  const setupTwoProjectOwner = async () => {
    const base = await setup();
    const { business, owner } = base;
    const advocate2User = await createTestUser({ company: { _id: business }, adminAccess: false });
    const advocate2 = await SaleAdvocate.create({ business, advocateNumber: `ADV2-${++seq}`, fullName: "Second Advocate", phone: `0744${seq}`, userIds: [advocate2User._id] });
    const project2 = await SaleProject.create({ business, projectNumber: `PRJ2-${seq}`, name: `Other Estate ${seq}`, owner: owner._id, assignedAdvocate: advocate2._id });
    const asAdvocate2 = (fn, opts = {}) => callController(fn, { user: advocate2User, saleAdvocateId: String(advocate2._id), ...opts });

    const liabilityAccount = await getAccountByCode(business, "2120");
    const makeVoucherOnProject = async (amount, dueDate, saleProject) =>
      (await base.staffCall(createPaymentVoucher, {
        body: { category: "sale_owner_expense", saleOwner: String(owner._id), saleProject: saleProject ? String(saleProject) : undefined, liabilityAccount: String(liabilityAccount._id), amount, dueDate, status: "approved" },
      })).payload;

    return { ...base, advocate2, project2, asAdvocate2, makeVoucherOnProject };
  };

  it("an advocate sees a voucher tagged to a DIFFERENT project of the same owner too", async () => {
    const { asAdvocate, project2, makeVoucherOnProject } = await setupTwoProjectOwner();
    const voucher = await makeVoucherOnProject(7_000, "2026-01-01", project2._id); // tagged to advocate2's project

    const res = await asAdvocate(listOutstandingRecharges, {});
    expect(res.payload.data.map((v) => String(v.voucherId))).toEqual([String(voucher._id)]);
  });

  it("the other project's advocate sees it too — both advocates linked to this owner see the same recharge", async () => {
    const { asAdvocate2, project2, makeVoucherOnProject } = await setupTwoProjectOwner();
    const voucher = await makeVoucherOnProject(7_000, "2026-01-01", project2._id);

    const res = await asAdvocate2(listOutstandingRecharges, {});
    expect(res.payload.data.map((v) => String(v.voucherId))).toEqual([String(voucher._id)]);
  });

  it("a project-less (owner-general) voucher is visible to either advocate too", async () => {
    const { asAdvocate, asAdvocate2, makeVoucherOnProject } = await setupTwoProjectOwner();
    const voucher = await makeVoucherOnProject(3_000, "2026-01-01", null);

    const res1 = await asAdvocate(listOutstandingRecharges, {});
    const res2 = await asAdvocate2(listOutstandingRecharges, {});
    expect(res1.payload.data.map((v) => String(v.voucherId))).toEqual([String(voucher._id)]);
    expect(res2.payload.data.map((v) => String(v.voucherId))).toEqual([String(voucher._id)]);
  });

  it("an advocate CAN remit a voucher tagged to a different project of the same owner", async () => {
    const { asAdvocate, owner, project2, makeVoucherOnProject } = await setupTwoProjectOwner();
    const voucher = await makeVoucherOnProject(7_000, "2026-01-01", project2._id);

    const res = await asAdvocate(createRechargeRemittance, {
      body: { owner: String(owner._id), allocations: [{ voucher: String(voucher._id), amount: 7_000 }] },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("recharge remittance — create", () => {
  it("settles one voucher in full: posts Dr cashbook / Cr 1313 for the full amount, and the voucher drops off the outstanding list", async () => {
    const { business, asAdvocate, advocate, owner, makeVoucher } = await setup();
    const voucher = await makeVoucher(15_000, "2026-01-01");

    const res = await asAdvocate(createRechargeRemittance, {
      body: { owner: String(owner._id), allocations: [{ voucher: String(voucher._id), amount: 15_000 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.payload.amount).toBe(15_000);
    expect(res.payload.remittanceNumber).toMatch(/^RCG/);

    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_advocate_recharge_remittance", sourceTransactionId: String(res.payload._id) }).lean();
    expect(legs).toHaveLength(2);
    const recoverableAcc = await getAccountByCode(business, "1313");
    expect(legs.find((l) => l.direction === "credit")).toMatchObject({ accountId: recoverableAcc._id, credit: 15_000 });
    expect(legs.find((l) => l.direction === "debit")).toMatchObject({ debit: 15_000 });

    const after = await asAdvocate(listOutstandingRecharges, {});
    expect(after.payload.data).toEqual([]);
  });

  it("settles a partial amount — the voucher stays outstanding for the remainder", async () => {
    const { asAdvocate, owner, makeVoucher } = await setup();
    const voucher = await makeVoucher(15_000, "2026-01-01");

    await asAdvocate(createRechargeRemittance, { body: { owner: String(owner._id), allocations: [{ voucher: String(voucher._id), amount: 6_000 }] } });

    const after = await asAdvocate(listOutstandingRecharges, {});
    expect(after.payload.data).toHaveLength(1);
    expect(String(after.payload.data[0].voucherId)).toBe(String(voucher._id));
    expect(after.payload.data[0].outstanding).toBe(9_000);
  });

  it("settles two vouchers in one remittance", async () => {
    const { business, asAdvocate, owner, makeVoucher } = await setup();
    const v1 = await makeVoucher(5_000, "2026-01-01");
    const v2 = await makeVoucher(8_000, "2026-02-01");

    const res = await asAdvocate(createRechargeRemittance, {
      body: { owner: String(owner._id), allocations: [{ voucher: String(v1._id), amount: 5_000 }, { voucher: String(v2._id), amount: 8_000 }] },
    });
    expect(res.payload.amount).toBe(13_000);
    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_advocate_recharge_remittance", sourceTransactionId: String(res.payload._id) }).lean();
    expect(legs.find((l) => l.direction === "credit")).toMatchObject({ credit: 13_000 });

    const after = await asAdvocate(listOutstandingRecharges, {});
    expect(after.payload.data).toEqual([]);
  });

  it("rejects an allocation amount exceeding the voucher's outstanding balance", async () => {
    const { asAdvocate, owner, makeVoucher } = await setup();
    const voucher = await makeVoucher(5_000, "2026-01-01");
    await expect(asAdvocate(createRechargeRemittance, {
      body: { owner: String(owner._id), allocations: [{ voucher: String(voucher._id), amount: 5_001 }] },
    })).rejects.toThrow(/exceeds its outstanding balance/);
  });

  it("rejects allocating the same voucher twice in one request", async () => {
    const { asAdvocate, owner, makeVoucher } = await setup();
    const voucher = await makeVoucher(10_000, "2026-01-01");
    await expect(asAdvocate(createRechargeRemittance, {
      body: { owner: String(owner._id), allocations: [{ voucher: String(voucher._id), amount: 4_000 }, { voucher: String(voucher._id), amount: 4_000 }] },
    })).rejects.toThrow(/cannot be allocated twice/);
  });

  it("rejects a voucher that belongs to a different owner (staff caller, so the owner-scope check isn't what's being exercised here)", async () => {
    const { business, staffCall, owner, makeVoucher } = await setup();
    const otherOwner = await SaleOwner.create({ business, ownerNumber: `OWN-Y-${++seq}`, fullName: "Owner Y", phone: `0701${seq}` });
    const voucher = await makeVoucher(5_000, "2026-01-01");
    const advocate = await SaleAdvocate.create({ business, advocateNumber: `ADV-STAFF-${++seq}`, fullName: "Staff-created Advocate", phone: `0703${seq}` });
    await expect(staffCall(createRechargeRemittance, {
      body: { advocate: String(advocate._id), owner: String(otherOwner._id), allocations: [{ voucher: String(voucher._id), amount: 5_000 }] },
    })).rejects.toThrow(/was not found for this owner/);
  });

  it("404s an advocate trying to remit for an owner outside their own scope", async () => {
    const { business, asAdvocate, makeVoucher } = await setup();
    const otherOwner = await SaleOwner.create({ business, ownerNumber: `OWN-Z-${++seq}`, fullName: "Owner Z", phone: `0702${seq}` });
    const voucher = await makeVoucher(5_000, "2026-01-01");
    await expect(asAdvocate(createRechargeRemittance, {
      body: { owner: String(otherOwner._id), allocations: [{ voucher: String(voucher._id), amount: 1 }] },
    })).rejects.toThrow(/Owner not found/);
  });
});

describe("recharge remittance — void", () => {
  it("reverses the GL and restores the voucher's outstanding balance", async () => {
    const { business, staffCall, asAdvocate, owner, makeVoucher } = await setup();
    const voucher = await makeVoucher(15_000, "2026-01-01");
    const created = await asAdvocate(createRechargeRemittance, {
      body: { owner: String(owner._id), allocations: [{ voucher: String(voucher._id), amount: 15_000 }] },
    });

    const voided = await staffCall(voidRechargeRemittance, { params: { id: String(created.payload._id) }, body: { reason: "entered against wrong voucher" } });
    expect(voided.payload.status).toBe("cancelled");

    const recoverableAcc = await getAccountByCode(business, "1313");
    const net = (await FinancialLedgerEntry.find({ business, accountId: recoverableAcc._id }).lean())
      .reduce((s, r) => s + Number(r.debit || 0) - Number(r.credit || 0), 0);
    expect(net).toBe(15_000); // back to the voucher's own un-recovered accrual

    const after = await asAdvocate(listOutstandingRecharges, {});
    expect(after.payload.data).toHaveLength(1);
    expect(String(after.payload.data[0].voucherId)).toBe(String(voucher._id));
    expect(after.payload.data[0].outstanding).toBe(15_000);
  });
});

describe("recharge remittance — list", () => {
  it("an advocate only ever lists their own remittances", async () => {
    const { business, staffCall, asAdvocate, advocate, owner, makeVoucher } = await setup();
    const voucher = await makeVoucher(5_000, "2026-01-01");
    await asAdvocate(createRechargeRemittance, { body: { owner: String(owner._id), allocations: [{ voucher: String(voucher._id), amount: 5_000 }] } });

    const otherAdvocate = await SaleAdvocate.create({ business, advocateNumber: `ADV-OTH-${++seq}`, fullName: "Other Advocate", phone: `0744${seq}` });
    const res = await staffCall(listRechargeRemittances, { query: { advocate: String(otherAdvocate._id) } });
    expect(res.payload.data).toEqual([]);

    const mine = await asAdvocate(listRechargeRemittances, {});
    expect(mine.payload.data).toHaveLength(1);
    expect(String(mine.payload.data[0].advocate._id)).toBe(String(advocate._id));
  });
});
