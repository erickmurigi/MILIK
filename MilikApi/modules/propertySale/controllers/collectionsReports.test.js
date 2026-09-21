// Receivables aging, overdue instalments and the sales register.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import SaleProject from "../models/SaleProject.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import { getOverdueInstallments, getReceivables, getSalesRegister } from "./collectionsReportsController.js";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  const user = await createTestUser({ company });
  const call = (fn, query = {}) => callController(fn, { user, query });
  const business = company._id;
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Kitengela Plots" });
  const other = await SaleProject.create({ business, projectNumber: "PRJ-2", name: "Athi River" });
  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent" });

  // one deal with agreed price, payments and instalments [daysLate, amount, paid?]
  const deal = async ({ price, paid = 0, installments = [], proj = project, status = "active", asking = price + 50_000, name = "Buyer" }) => {
    const n = ++seq;
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `${name} ${n}`, phone: `0700${n}` });
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, unitNumber: String(n), askingPrice: asking, project: proj._id });
    const d = await SaleDeal.create({ business, dealNumber: `D-${n}`, listing: listing._id, buyer: buyer._id, agent: agent._id, agreedPrice: price, status });
    if (paid) await SalePayment.create({ business, paymentNumber: `P-${n}`, deal: d._id, amount: paid, status: "paid" });
    let i = 0;
    for (const [late, amount, done] of installments) {
      await SalePaymentSchedule.create({ business, deal: d._id, installmentNumber: ++i, dueDate: daysAgo(late), expectedAmount: amount, status: done ? "paid" : "upcoming" });
    }
    return d;
  };
  return { company, call, deal, project, other, agent };
};

describe("sale receivables", () => {
  it("ages what buyers owe by how late the unpaid instalments are, and shows unscheduled balance apart", async () => {
    const { call, deal } = await setup();
    // price 1,000,000; paid 400,000; instalments: 45 days late 200k, 5 days late 100k, due in 20 days 150k -> 150k has no instalment date
    await deal({ price: 1_000_000, paid: 400_000, installments: [[45, 200_000], [5, 100_000], [-20, 150_000]] });
    // fully paid deal, must not appear
    await deal({ price: 500_000, paid: 500_000 });
    // cancelled deal, must not appear
    await deal({ price: 700_000, status: "cancelled", installments: [[10, 700_000]] });

    const { payload } = await call(getReceivables);
    expect(payload.total).toBe(1);
    expect(payload.data[0]).toMatchObject({ balance: 600_000, paid: 400_000, overdue: 300_000, unscheduled: 150_000, d31_60: 200_000, d1_30: 100_000, notDue: 150_000 });
    expect(payload.data[0].daysLate).toBeGreaterThanOrEqual(45);
    expect(payload.totals).toMatchObject({ balance: 600_000, overdue: 300_000, unscheduled: 150_000, d31_60: 200_000, d1_30: 100_000, d61_90: 0, d90plus: 0 });
  });

  it("filters by project and by overdue only", async () => {
    const { call, deal, project, other } = await setup();
    await deal({ price: 100_000, installments: [[100, 100_000]] });                 // 90+ overdue, project 1
    await deal({ price: 200_000, proj: other, installments: [[-10, 200_000]] });    // not due, project 2
    const p1 = (await call(getReceivables, { projectId: String(project._id) })).payload;
    expect(p1.total).toBe(1);
    expect(p1.data[0].d90plus).toBe(100_000);
    const overdueOnly = (await call(getReceivables, { overdueOnly: "1" })).payload;
    expect(overdueOnly.total).toBe(1);
    const all = (await call(getReceivables)).payload;
    expect(all.total).toBe(2);
  });
});

describe("overdue instalments", () => {
  it("lists unpaid instalments past due, oldest first, skipping paid, future and cancelled-deal ones", async () => {
    const { call, deal } = await setup();
    await deal({ price: 300_000, installments: [[70, 100_000], [20, 100_000], [-5, 100_000]], name: "Anna" });
    await deal({ price: 100_000, installments: [[10, 100_000, true]] });                 // paid instalment
    await deal({ price: 100_000, status: "cancelled", installments: [[200, 100_000]] }); // cancelled deal

    const { payload } = await call(getOverdueInstallments);
    expect(payload.total).toBe(2);
    expect(payload.data.map((r) => r.bucket)).toEqual(["d61_90", "d1_30"]);
    expect(payload.data[0]).toMatchObject({ amount: 100_000, installmentNumber: 1 });
    expect(payload.data[0].buyerName).toMatch(/^Anna/);
    expect(payload.data[0].buyerPhone).toBeTruthy();
    expect(payload.totals).toMatchObject({ count: 2, amount: 200_000 });
    expect(payload.totals.buckets.d61_90).toEqual({ count: 1, amount: 100_000 });

    const late = (await call(getOverdueInstallments, { minDays: "30" })).payload;
    expect(late.total).toBe(1);
  });
});

describe("sales register", () => {
  it("shows discount, paid and balance, and totals over the whole filter", async () => {
    const { call, deal, project } = await setup();
    await deal({ price: 900_000, paid: 300_000, asking: 1_000_000, name: "Zed" });
    await deal({ price: 400_000, paid: 400_000, asking: 400_000 });
    await deal({ price: 250_000, paid: 50_000, status: "cancelled" });

    const all = (await call(getSalesRegister)).payload;
    expect(all.total).toBe(3);
    expect(all.totals).toMatchObject({ deals: 3, cancelled: 1, agreed: 1_300_000, paid: 750_000, balance: 600_000 });
    const zed = all.data.find((r) => r.buyerName.startsWith("Zed"));
    expect(zed).toMatchObject({ askingPrice: 1_000_000, discount: 100_000, paid: 300_000, balance: 600_000, project: "Kitengela Plots" });
    expect(all.data.find((r) => r.status === "cancelled").balance).toBe(0);

    const paged = (await call(getSalesRegister, { limit: "2", page: "2" })).payload;
    expect(paged.data).toHaveLength(1);
    expect(paged.totals.deals).toBe(3);

    expect((await call(getSalesRegister, { search: "Zed" })).payload.total).toBe(1);
    expect((await call(getSalesRegister, { status: "cancelled" })).payload.total).toBe(1);
    expect((await call(getSalesRegister, { projectId: String(project._id) })).payload.total).toBe(3);
    await expect(call(getSalesRegister, { projectId: "nope" })).rejects.toThrow(/Invalid project/);
  });
});
