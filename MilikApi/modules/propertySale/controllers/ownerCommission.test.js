// Owner-backed deals: the company's own agency commission, and re-pointing the broker's accrual away
// from the plain Commission Expense account once a project has an owner to bill it to.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { updateCommissionStatus } from "./commissionsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
  const owner = await SaleOwner.create({ business, ownerNumber: "OWN-1", fullName: "John Mwangi", phone: "0722000222" });

  const makeProject = (withOwner) =>
    SaleProject.create({ business, projectNumber: `PRJ-${++seq}`, name: `Sunset Gardens ${seq}`, owner: withOwner ? owner._id : null });

  const newDeal = async ({ project, withAgent = true } = {}) => {
    const n = ++seq;
    const listing = await SaleListing.create({
      business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000,
      project: project ? project._id : null, unitNumber: project ? `U${n}` : undefined,
    });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const body = { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000 };
    if (withAgent) body.agent = String(agent._id);
    const res = await call(createDeal, { body });
    return res.payload;
  };

  return { business, call, owner, agent, makeProject, newDeal };
};

describe("owner-backed deals — commission creation", () => {
  it("a deal under a project with no owner creates only the broker commission, unchanged", async () => {
    const { business, newDeal } = await setup();
    const deal = await newDeal();
    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission).toMatchObject({ commissionAmount: 20000, owner: null, releaseSchedule: [] });
    expect(await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean()).toBeNull();
  });

  it("a deal under an owner's project creates both the broker commission (owner-tagged) and the company's own commission", async () => {
    const { business, owner, makeProject, newDeal, call } = await setup();
    const project = await makeProject(true);
    const deal = await newDeal({ project });

    const brokerCommission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(brokerCommission).toMatchObject({ commissionAmount: 20000, owner: owner._id });

    const ownerCommission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(ownerCommission).toMatchObject({ owner: owner._id, commissionAmount: 30000, commissionRate: 3, commissionType: "percentage" });
  });

  it("creates the company's own commission even with no agent on the deal at all", async () => {
    const { business, owner, makeProject, newDeal } = await setup();
    const project = await makeProject(true);
    const deal = await newDeal({ project, withAgent: false });

    expect(await SaleCommission.findOne({ business, deal: deal._id }).lean()).toBeNull();
    const ownerCommission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(ownerCommission).toMatchObject({ owner: owner._id, commissionAmount: 30000 });
  });
});

describe("owner-backed deals — GL re-pointing on broker accrual", () => {
  it("posts to 5320 Commission Expense when the deal has no owner (legacy, unchanged)", async () => {
    const { business, newDeal, call } = await setup();
    const deal = await newDeal();
    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });

    const expenseAcc = await getAccountByCode(business, "5320");
    const rows = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission", sourceTransactionId: String(commission._id) }).lean();
    expect(rows).toMatchObject([{ accountId: expenseAcc._id, direction: "debit", debit: 20000 }, { direction: "credit", credit: 20000 }]);
  });

  it("posts to 2185 Owner Clearing instead of 5320 when the deal's project has an owner", async () => {
    const { business, makeProject, newDeal, call } = await setup();
    const project = await makeProject(true);
    const deal = await newDeal({ project });
    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });

    const clearingAcc = await getAccountByCode(business, "2185");
    const rows = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission", sourceTransactionId: String(commission._id) }).lean();
    expect(rows).toMatchObject([{ accountId: clearingAcc._id, direction: "debit", debit: 20000 }, { direction: "credit", credit: 20000 }]);

    // 5320 must not have been touched by this owner-linked accrual
    const expenseAcc = await getAccountByCode(business, "5320").catch(() => null);
    if (expenseAcc) {
      const stray = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission", accountId: expenseAcc._id }).lean();
      expect(stray.length).toBe(0);
    }
  });
});
