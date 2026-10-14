// A staged (tiered) commission accrues tier-by-tier as the buyer pays, independent of the manual
// pending -> approved status flip. Before this fix, clicking "Approve" on a staged commission that
// already had one or more tiers accrue would ALSO post a full-gross-amount accrual under a different
// sourceTransactionType, double-counting the commission expense/payable on top of the tier postings —
// the two accrual functions use different sourceTransactionType keys ("property_sale_commission" vs
// "property_sale_commission_tier"), so neither's idempotency guard could see the other's entries.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { updateCommissionReleaseSchedule } from "./settingsController.js";
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
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", owner: owner._id });

  await call(updateCommissionReleaseSchedule, {
    body: { enabled: true, ownerCommissionTiers: [], brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 100, releasePct: 100 }] },
  });

  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
  const deal = dealRes.payload;

  return { business, call, deal };
};

describe("commissionsController — approving a staged commission must not double-post its accrual", () => {
  it("a partially-released staged commission, when manually approved, gets NO extra accrual entries — only the tier's", async () => {
    const { business, call, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 300_000, paymentType: "installment" } }); // 30% -> first tier fires, 50% of 20,000 = 10,000

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.status).toBe("pending"); // tier accrual never advances status
    expect(commission.releasedAmount).toBe(10_000);

    const tierEntriesBefore = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission_tier" }).lean();
    expect(tierEntriesBefore).toHaveLength(2); // one tier release, 2 legs

    const approved = await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    expect(approved.statusCode).toBe(200);
    expect(approved.payload.status).toBe("approved");

    // The full-accrual sourceTransactionType must have NOTHING posted under it for a staged commission.
    const fullAccrualEntries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission", sourceTransactionId: String(commission._id) }).lean();
    expect(fullAccrualEntries).toHaveLength(0);

    // The tier entries are untouched — still exactly the one tier's worth, nothing added by Approve.
    const tierEntriesAfter = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission_tier" }).lean();
    expect(tierEntriesAfter).toHaveLength(2);

    // 2180 Agent Commission Payable must equal exactly the one released tier (10,000), not 10,000 + 20,000.
    const payableLegs = tierEntriesAfter.filter((e) => e.direction === "credit");
    const totalPayable = payableLegs.reduce((s, e) => s + Number(e.credit || 0), 0);
    expect(totalPayable).toBe(10_000);
  });

  it("a legacy (non-staged) commission still gets its full accrual posted on approve, unaffected", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const business = company._id;
    const call = (fn, opts = {}) => callController(fn, { user, ...opts });

    const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, unitNumber: `U${n}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
    const commission = await SaleCommission.findOne({ business, deal: dealRes.payload._id }).lean();
    expect(commission.releaseSchedule).toHaveLength(0);

    const approved = await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    expect(approved.statusCode).toBe(200);

    const entries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission", sourceTransactionId: String(commission._id) }).lean();
    expect(entries).toHaveLength(2);
    expect(entries.reduce((s, e) => s + Number(e.credit || 0), 0)).toBe(20_000);
  });
});
