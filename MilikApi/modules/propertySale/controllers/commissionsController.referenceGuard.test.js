// System-wide duplicate-reference guard, applied to SaleCommission.payoutReference (paymentReferenceGuard.js).
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
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
  const makeCommission = async () => {
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}-${Math.random()}`, title: `Plot ${n}`, askingPrice: 1_000_000, unitNumber: `U${n}-${Math.random()}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}-${Math.random()}`, fullName: `Buyer ${n}`, phone: `0700${Math.floor(Math.random() * 1e6)}`, email: `b${Math.random()}@example.com` });
    const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
    const commission = await SaleCommission.findOne({ business, deal: dealRes.payload._id }).lean();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    return commission;
  };

  return { business, call, makeCommission };
};

describe("updateCommissionStatus — payoutReference duplicate guard", () => {
  it("rejects paying out a second commission with a reference already used by another", async () => {
    const { call, makeCommission } = await setup();
    const c1 = await makeCommission();
    const c2 = await makeCommission();

    const paid1 = await call(updateCommissionStatus, {
      params: { id: String(c1._id) },
      body: { status: "paid", payoutDate: "2026-01-01", payoutMethod: "bank_transfer", payoutReference: "EFT-COMM-01" },
    });
    expect(paid1.statusCode).toBe(200);

    await expect(
      call(updateCommissionStatus, {
        params: { id: String(c2._id) },
        body: { status: "paid", payoutDate: "2026-01-02", payoutMethod: "bank_transfer", payoutReference: "eft-comm-01" },
      })
    ).rejects.toThrow(/already used/i);

    const reloaded = await SaleCommission.findById(c2._id).lean();
    expect(reloaded.status).toBe("approved"); // rejected before the status update landed
  });
});
