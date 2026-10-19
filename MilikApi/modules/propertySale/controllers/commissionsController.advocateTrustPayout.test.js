// Broker commission paid via advocate trust (§8.3a): updateCommissionStatus's source="advocate_trust"
// path — the deal-scoped trust-balance guard rejects an over-draw, and the WHT leg is present/absent
// per the advocate's (or the company default's) whtHandledBy setting.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { updateCommissionStatus } from "./commissionsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
  const advocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-1", fullName: "John Advocate", firm: "Kamau & Co", phone: "0733000333" });
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", assignedAdvocate: advocate._id });

  const makeDeal = async () => {
    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const res = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
    return res.payload;
  };

  const payAdvocateTrust = (deal, amount) =>
    call(createPayment, { body: { deal: String(deal._id), amount, paymentType: "installment", collectionMethod: "advocate_trust" } });

  // Payout entries are keyed per-payout (`${commissionId}:payout:${payoutId}`), not by the bare
  // commission id — resolve the commission's actual payout ids first, exactly like
  // reversePropertySaleCommissionPayout's own lookup does.
  const legs = async (id, type) => {
    if (type !== "property_sale_commission_payout") return FinancialLedgerEntry.find({ business, sourceTransactionType: type, sourceTransactionId: String(id) }).lean();
    const comm = await SaleCommission.findById(id).lean();
    const ids = comm?.payouts?.length ? comm.payouts.map((p) => `${id}:payout:${p._id}`) : [String(id)];
    return FinancialLedgerEntry.find({ business, sourceTransactionType: type, sourceTransactionId: { $in: ids } }).lean();
  };

  return { business, call, advocate, project, makeDeal, payAdvocateTrust, legs };
};

describe("commission payout via advocate trust — trust-balance guard", () => {
  it("rejects a payout that exceeds this deal's advocate trust balance, leaving the commission approved and nothing posted", async () => {
    const { business, call, makeDeal, payAdvocateTrust, legs } = await setup();
    const deal = await makeDeal(); // 20,000 commission (2% of 1,000,000)
    await payAdvocateTrust(deal, 10_000); // only half the commission is actually in trust

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });

    await expect(
      call(updateCommissionStatus, {
        params: { id: String(commission._id) },
        body: { status: "paid", source: "advocate_trust", payoutDate: "2026-10-01", payoutMethod: "bank_transfer" },
      })
    ).rejects.toThrow(/trust balance/i);

    expect((await SaleCommission.findById(commission._id).lean()).status).toBe("approved");
    expect((await legs(commission._id, "property_sale_commission_payout")).length).toBe(0);
  });

  it("succeeds exactly at the trust balance (no tolerance-breaking off-by-one)", async () => {
    const { business, call, makeDeal, payAdvocateTrust } = await setup();
    const deal = await makeDeal();
    await payAdvocateTrust(deal, 20_000); // exactly the commission amount

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    const res = await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", source: "advocate_trust", payoutDate: "2026-10-01", payoutMethod: "bank_transfer" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.payoutSource).toBe("advocate_trust");
  });
});

describe("commission payout via advocate trust — WHT leg present/absent per whtHandledBy", () => {
  it("whtHandledBy default (agent, company default): credits 1314 net and 2141 the withheld tax", async () => {
    const { business, call, makeDeal, payAdvocateTrust, legs } = await setup();
    const deal = await makeDeal();
    await payAdvocateTrust(deal, 20_000);

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.whtAmount).toBe(1_000); // 5% of 20,000
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", source: "advocate_trust", payoutDate: "2026-10-01", payoutMethod: "bank_transfer" },
    });

    const rows = await legs(commission._id, "property_sale_commission_payout");
    expect(rows.length).toBe(3);
    const trustAcc = await getAccountByCode(business, "1314");
    const whtAcc = await getAccountByCode(business, "2141");
    expect(rows.find((r) => String(r.accountId) === String(trustAcc._id))).toMatchObject({ direction: "credit", credit: 19_000 });
    expect(rows.find((r) => String(r.accountId) === String(whtAcc._id))).toMatchObject({ direction: "credit", credit: 1_000 });
  });

  it("whtHandledBy='advocate' (set on the collecting advocate): no 2141 leg, full gross credited to 1314", async () => {
    const { business, call, advocate, makeDeal, payAdvocateTrust, legs } = await setup();
    await SaleAdvocate.updateOne({ _id: advocate._id }, { whtHandledBy: "advocate" });
    const deal = await makeDeal();
    await payAdvocateTrust(deal, 20_000);

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", source: "advocate_trust", payoutDate: "2026-10-01", payoutMethod: "bank_transfer" },
    });

    const rows = await legs(commission._id, "property_sale_commission_payout");
    expect(rows.length).toBe(2);
    const trustAcc = await getAccountByCode(business, "1314");
    expect(rows.find((r) => r.direction === "credit")).toMatchObject({ accountId: trustAcc._id, credit: 20_000 });
  });
});

describe("commission payout — company_cashbook regression (source omitted)", () => {
  it("behaves exactly as before: cashbook/5321 credit, unaffected by the new advocate-trust path", async () => {
    const { business, call, makeDeal } = await setup();
    const deal = await makeDeal();
    // Pay directly (not advocate_trust) so the deal's trust balance stays irrelevant to this path.
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    const res = await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", payoutDate: "2026-10-01", payoutMethod: "bank_transfer" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.payoutSource).toBe("company_cashbook");

    const paidCommission = await SaleCommission.findById(commission._id).lean();
    const rows = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission_payout", sourceTransactionId: { $in: paidCommission.payouts.map((p) => `${commission._id}:payout:${p._id}`) } }).lean();
    const fallbackAcc = await getAccountByCode(business, "5321");
    expect(rows.find((r) => r.direction === "credit")).toMatchObject({ accountId: fallbackAcc._id, credit: 19_000 });
  });
});
