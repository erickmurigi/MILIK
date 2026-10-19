// Agency Commissions page's backing endpoint — read-only list over SaleOwnerCommission.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { updateOwnerCommissionDefaults } from "./settingsController.js";
import { listOwnerCommissions, getOwnerCommission, recalculateOwnerCommissionRate } from "./ownerCommissionsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const owner = await SaleOwner.create({ business, ownerNumber: "OWN-1", fullName: "John Mwangi", phone: "0722000222" });
  const project = await SaleProject.create({ business, projectNumber: `PRJ-${++seq}`, name: `Sunset Gardens ${seq}`, owner: owner._id });

  const newDeal = async () => {
    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const res = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000 } });
    return res.payload;
  };

  return { business, call, owner, newDeal };
};

describe("listOwnerCommissions", () => {
  it("lists agency commissions created for owner-backed deals, with per-status stats", async () => {
    const { call, newDeal } = await setup();
    await newDeal();
    await newDeal();

    const res = await call(listOwnerCommissions, {});
    expect(res.statusCode).toBe(200);
    expect(res.payload.data).toHaveLength(2);
    expect(res.payload.total).toBe(2);
    // No release tiers configured for this business -> auto-recognized in full at creation (status "approved").
    expect(res.payload.stats.approved.count).toBe(2);
    expect(res.payload.data[0].owner.fullName).toBe("John Mwangi");
    expect(res.payload.data[0].commissionAmount).toBe(30_000); // 3% default rate of 1,000,000
  });

  it("filters by status and by owner", async () => {
    const { business, call, owner, newDeal } = await setup();
    await newDeal();

    const byStatus = await call(listOwnerCommissions, { query: { status: "pending" } });
    expect(byStatus.payload.data).toHaveLength(0); // the one commission is already "approved"

    const byOwner = await call(listOwnerCommissions, { query: { ownerId: String(owner._id) } });
    expect(byOwner.payload.data).toHaveLength(1);
  });
});

describe("getOwnerCommission", () => {
  it("returns 404 for a commission outside the caller's business", async () => {
    const { call } = await setup();
    await expect(call(getOwnerCommission, { params: { id: "507f1f77bcf86cd799439011" } })).rejects.toThrow(/not found/i);
  });
});

describe("recalculateOwnerCommissionRate", () => {
  it("re-derives amount and GL from the CURRENT ownerCommissionDefaults rate — not the rate at deal creation", async () => {
    const { business, call, newDeal } = await setup();
    const deal = await newDeal();
    const before = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(before).toMatchObject({ commissionRate: 3, commissionAmount: 30_000, status: "approved" });

    await call(updateOwnerCommissionDefaults, { body: { rate: 5, commissionType: "percentage" } });

    const res = await call(recalculateOwnerCommissionRate, { params: { id: String(before._id) } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.commissionRate).toBe(5);
    expect(res.payload.commissionAmount).toBe(50_000); // 5% of 1,000,000, not 3%
    expect(res.payload.status).toBe("approved"); // immediate release stays auto-approved

    const reloaded = await SaleOwnerCommission.findById(before._id).lean();
    expect(reloaded.commissionAmount).toBe(50_000);
    expect(reloaded.releasedAmount).toBe(50_000);

    // Old GL (30,000) must be reversed and the new GL (50,000) posted — net ledger effect is the new amount.
    const entries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_owner_commission_tier" }).lean();
    const approved = entries.filter((e) => e.status === "approved" && e.category !== "REVERSAL");
    const netDebit = approved.filter((e) => e.direction === "debit").reduce((s, e) => s + e.debit, 0);
    expect(netDebit).toBe(50_000);
  });

  it("rejects recalculating a cancelled agency commission", async () => {
    const { business, call, newDeal } = await setup();
    const deal = await newDeal();
    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    await SaleOwnerCommission.updateOne({ _id: commission._id }, { status: "cancelled" });

    await expect(
      call(recalculateOwnerCommissionRate, { params: { id: String(commission._id) } })
    ).rejects.toThrow(/pending or approved/i);
  });
});
