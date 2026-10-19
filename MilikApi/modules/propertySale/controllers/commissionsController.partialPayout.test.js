// Partial commission payouts: a large commission can be disbursed across several real-world cash
// movements (not just one lump sum). Status stays "approved" until paidOutAmount covers the full
// commissionAmount; each payout's WHT is its own proportional share, summing exactly to whtAmount once
// fully paid (no stray cent); the whole thing stays reversible, and reversal undoes every payout at once.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
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

  const agent = await SaleAgent.create({ business, agentNumber: `AG-${++seq}`, fullName: "Jane Agent", phone: `0711${seq}`, commissionRate: 3, commissionType: "percentage" });
  const n = seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
  const commission = await SaleCommission.findOne({ business, deal: dealRes.payload._id }).lean();
  await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });

  return { business, call, commission };
};

describe("updateCommissionStatus — partial payouts", () => {
  it("a 50% payout keeps status 'approved' and records paidOutAmount/payouts; the remainder completes it", async () => {
    const { business, call, commission } = await setup();
    // commissionAmount = 30,000 (3% of 1,000,000); whtAmount = 1,500 (5% default)
    expect(commission.commissionAmount).toBe(30_000);
    expect(commission.whtAmount).toBe(1_500);

    const first = await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", amount: 15_000, payoutDate: "2026-01-01", payoutMethod: "bank_transfer", payoutReference: "EFT-01" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.payload.status).toBe("approved"); // not fully paid yet
    expect(first.payload.paidOutAmount).toBe(15_000);
    expect(first.payload.payouts).toHaveLength(1);
    expect(first.payload.payouts[0]).toMatchObject({ amount: 15_000, whtAmount: 750, netAmount: 14_250 });

    const second = await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", amount: 15_000, payoutDate: "2026-01-15", payoutMethod: "mpesa", payoutReference: "QJ99" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.payload.status).toBe("paid"); // now fully settled
    expect(second.payload.paidOutAmount).toBe(30_000);
    expect(second.payload.payouts).toHaveLength(2);

    // The two payouts' WHT sum to exactly the commission's total whtAmount — no rounding stray.
    const totalWhtAcrossPayouts = second.payload.payouts.reduce((s, p) => s + p.whtAmount, 0);
    expect(totalWhtAcrossPayouts).toBe(1_500);

    // GL: two separate payout journals, one per tranche, both debiting 2180 for their own slice.
    const entries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission_payout" }).lean();
    const approved = entries.filter((e) => e.status === "approved" && e.category !== "REVERSAL");
    const debits = approved.filter((e) => e.direction === "debit");
    expect(debits).toHaveLength(2);
    expect(debits.reduce((s, e) => s + e.debit, 0)).toBe(30_000);
  });

  it("omitting amount pays off the full remaining balance in one shot (unchanged default behavior)", async () => {
    const { call, commission } = await setup();
    const res = await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", payoutDate: "2026-01-01", payoutMethod: "cash" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe("paid");
    expect(res.payload.paidOutAmount).toBe(30_000);
    expect(res.payload.payouts).toHaveLength(1);
    expect(res.payload.payouts[0].amount).toBe(30_000);
  });

  it("rejects a payout amount exceeding the remaining balance", async () => {
    const { call, commission } = await setup();
    await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", amount: 20_000, payoutDate: "2026-01-01", payoutMethod: "cash" },
    });
    await expect(
      call(updateCommissionStatus, {
        params: { id: String(commission._id) },
        body: { status: "paid", amount: 15_000, payoutDate: "2026-01-02", payoutMethod: "cash" },
      })
    ).rejects.toThrow(/exceeds the remaining balance/i);
  });

  it("reversal (once fully paid) resets paidOutAmount to 0 and reverses every payout's GL entries", async () => {
    const { business, call, commission } = await setup();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "paid", amount: 10_000, payoutDate: "2026-01-01", payoutMethod: "cash" } });
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "paid", amount: 20_000, payoutDate: "2026-01-02", payoutMethod: "cash" } });

    const reversed = await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "reversed" } });
    expect(reversed.statusCode).toBe(200);
    expect(reversed.payload.status).toBe("reversed");
    expect(reversed.payload.paidOutAmount).toBe(0);
    // Audit trail of what was disbursed and reversed stays on the record.
    expect(reversed.payload.payouts).toHaveLength(2);

    const entries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission_payout" }).lean();
    expect(entries.every((e) => e.status === "reversed" || e.category === "REVERSAL")).toBe(true);
  });
});
