// Owner Statement: draft generation from proceeds + commission tiers, totals, and the
// draft-freely-regeneratable / approved-is-frozen lifecycle.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerStatement from "../models/SaleOwnerStatement.js";
import SaleOwnerStatementLine from "../models/SaleOwnerStatementLine.js";
import { createDeal, cancelDeal } from "./dealsController.js";
import { createPayment, voidPayment } from "./paymentsController.js";
import { updateCommissionStatus } from "./commissionsController.js";
import { updateCommissionReleaseSchedule } from "./settingsController.js";
import { approveStatement, createDraftStatement, deleteDraftStatement, getStatement, listStatements, reverseStatementApproval } from "./ownerStatementsController.js";
import { createOwnerPayout, getOwnerOutstandingBalance } from "./ownerPayoutsController.js";
import { createPaymentVoucher } from "../../../controllers/propertyController/paymentVoucher.js";
import { getAccountByCode } from "../../../test/factories.financial.js";

let seq = 0;
// A period guaranteed to contain "now" (when GL postings/updatedAt timestamps actually happen),
// regardless of what today's date is when the test runs — avoids a test that only passes by
// coincidence depending on which real month it's run in.
const periodStart = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const periodEnd = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 0); d.setHours(23, 59, 59, 999); return d.toISOString(); };

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
  const owner = await SaleOwner.create({ business, ownerNumber: "OWN-1", fullName: "John Mwangi", phone: "0722000222" });
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", owner: owner._id });

  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
  const deal = dealRes.payload;

  await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });

  // The broker's commission only becomes an owner cost once the company actually approves/accrues it —
  // a still-"pending" legacy commission is not yet a committed cost and must not appear on the statement.
  const brokerCommission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
  await call(updateCommissionStatus, { params: { id: String(brokerCommission._id) }, body: { status: "approved" } });

  return { business, call, owner, project, deal, agent };
};

describe("owner statement — generation and totals (immediate-release, no staging)", () => {
  it("includes proceeds and the company's own commission (auto-recognized immediately), net balance correct", async () => {
    const { business, owner, project, deal, call } = await setup();
    const res = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    expect(res.statusCode).toBe(201);
    const statement = res.payload;

    // deal: 1,000,000 price, owner commission default 3% = 30,000, broker 2% = 20,000
    expect(statement).toMatchObject({
      status: "draft", grossProceeds: 1_000_000, companyCommission: 30_000, brokerCommission: 20_000, rechargedExpenses: 0,
      netBalance: 1_000_000 - 30_000 - 20_000,
    });

    const full = await call(getStatement, { params: { id: String(statement._id) } });
    expect(full.payload.lines.length).toBe(3); // 1 proceeds + 1 company commission + 1 broker commission
    const categories = full.payload.lines.map((l) => l.category).sort();
    expect(categories).toEqual(["broker_commission", "company_commission", "proceeds"]);
    // running balance folds credit (proceeds) then debits (commissions), ending at netBalance
    expect(full.payload.lines[full.payload.lines.length - 1].runningBalance).toBe(statement.netBalance);
  });

  it("includes a recharged expense voucher as a deduction, netBalance accounts for it too", async () => {
    const { business, owner, project, call } = await setup();
    const liabilityAccount = await getAccountByCode(business, "2120");
    const settlementAccount = await getAccountByCode(business, "1100");
    await call(createPaymentVoucher, {
      body: {
        category: "sale_owner_expense", saleOwner: String(owner._id), saleProject: String(project._id),
        liabilityAccount: String(liabilityAccount._id), settlementAccount: String(settlementAccount._id),
        amount: 15_000, dueDate: new Date(), paidDate: new Date(), narration: "Survey fee", status: "paid",
      },
    });

    const res = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    expect(res.payload).toMatchObject({
      grossProceeds: 1_000_000, companyCommission: 30_000, brokerCommission: 20_000, rechargedExpenses: 15_000,
      netBalance: 1_000_000 - 30_000 - 20_000 - 15_000,
    });
    const full = await call(getStatement, { params: { id: String(res.payload._id) } });
    const expenseLine = full.payload.lines.find((l) => l.category === "expense");
    expect(expenseLine).toMatchObject({ amount: 15_000, direction: "debit" });
  });

  it("a recharged expense voucher with no saleProject (an owner-level cost) shows up on the owner's combined statement but not on a single-project-scoped one", async () => {
    const { business, owner, project, call } = await setup();
    const liabilityAccount = await getAccountByCode(business, "2120");
    const settlementAccount = await getAccountByCode(business, "1100");
    await call(createPaymentVoucher, {
      body: {
        category: "sale_owner_expense", saleOwner: String(owner._id), // deliberately no saleProject
        liabilityAccount: String(liabilityAccount._id), settlementAccount: String(settlementAccount._id),
        amount: 8_000, dueDate: new Date(), paidDate: new Date(), narration: "Legal retainer", status: "paid",
      },
    });

    // Scoped to one project: an owner-general cost isn't that project's to show.
    const scoped = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    expect(scoped.payload.rechargedExpenses).toBe(0);

    // Not scoped to any one project (the owner's combined statement): it must show up.
    const combined = await call(createDraftStatement, { body: { owner: String(owner._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    expect(combined.payload.rechargedExpenses).toBe(8_000);
  });

  it("a bare 'To' date (e.g. \"2026-10-14\", exactly how a plain <input type=\"date\"> sends it) still includes activity recorded LATER that same day — it must mean the whole day, not midnight at its start", async () => {
    const { owner, project, call } = await setup();
    // setup() already pays the deal in full "now" (paymentDate defaults to the current moment) — reuse
    // that payment rather than adding a second one, which would just overpay an already-fully-paid deal.

    const bareToday = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" — exactly what <input type="date"> sends, no time component
    const res = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: bareToday } });
    expect(res.payload.grossProceeds).toBe(1_000_000);

    const full = await call(getStatement, { params: { id: String(res.payload._id) } });
    const proceedsLines = full.payload.lines.filter((l) => l.category === "proceeds");
    expect(proceedsLines.some((l) => l.amount === 1_000_000)).toBe(true);
  });

  it("regenerating a draft replaces its lines rather than duplicating them", async () => {
    const { owner, project, call } = await setup();
    const first = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    const second = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    expect(second.statusCode).toBe(200); // not 201 — it updated the existing draft, didn't create a new one
    expect(String(second.payload._id)).toBe(String(first.payload._id));
    const lines = await SaleOwnerStatementLine.find({ statement: first.payload._id }).lean();
    expect(lines.length).toBe(3); // still 3, not 6 — old lines were deleted before reinsert
  });

  it("approving freezes the statement — further writes are rejected", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    const approved = await call(approveStatement, { params: { id: String(draft.payload._id) } });
    expect(approved.payload.status).toBe("approved");

    await expect(
      call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } })
    ).rejects.toThrow(/already has an approved statement/);

    // Direct model-level mutation attempts are also blocked by the schema guard
    const doc = await SaleOwnerStatement.findById(draft.payload._id);
    doc.notes = "trying to edit an approved statement";
    await expect(doc.save()).rejects.toThrow(/cannot be modified/i);
  });

  it("an owner payout in the period shows as its own deduction and generation doesn't throw (LINE_CATEGORIES must include owner_payout)", async () => {
    const { owner, project, call } = await setup();
    const payoutRes = await call(createOwnerPayout, { body: { owner: String(owner._id), amount: 100_000, reference: "EFT-OS-1" } });
    expect(payoutRes.statusCode).toBe(201);

    const res = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    expect(res.statusCode).toBe(201);
    expect(res.payload).toMatchObject({
      grossProceeds: 1_000_000, companyCommission: 30_000, brokerCommission: 20_000, ownerPayouts: 100_000,
      netBalance: 1_000_000 - 30_000 - 20_000 - 100_000,
    });

    const full = await call(getStatement, { params: { id: String(res.payload._id) } });
    const payoutLine = full.payload.lines.find((l) => l.category === "owner_payout");
    expect(payoutLine).toMatchObject({ amount: 100_000, direction: "debit" });
  });

  it("a cancelled deal's commission tiers never show on the statement, even though tierReleases stays on the record for history", async () => {
    const { business, call, owner, project, agent } = await setup();
    await call(updateCommissionReleaseSchedule, {
      body: { enabled: true, ownerCommissionTiers: [{ thresholdPct: 30, releasePct: 100 }], brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 100 }] },
    });

    // A second deal on the same owner/project — crosses the 30% tier (so both commissions accrue real
    // tierReleases), then gets cancelled. cancelDeal reverses the GL and flips status to "cancelled" but
    // deliberately leaves tierReleases on the record (see dealsController.cancelDeal) — the statement
    // generator must not mistake that leftover history for a still-live cost.
    const n = Math.random();
    const listing = await SaleListing.create({ business, listingNumber: `LC-${n}`, title: `Cancelled Plot`, askingPrice: 1_000_000, project: project._id, unitNumber: `UC-${n}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `BC-${n}`, fullName: `Cancelled Buyer`, phone: `0799${n}`, email: `bc${n}@example.com` });
    const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
    const cancelledDeal = dealRes.payload;

    const paymentRes = await call(createPayment, { body: { deal: String(cancelledDeal._id), amount: 300_000, paymentType: "installment" } }); // 30% -> tier fires on both
    // Tier release is a one-way ratchet — voiding doesn't claw the accrued tier back, it only clears
    // cancelDeal's unrelated "non-deposit payments must be voided first" guard (see dealCancelWithTiers.test.js).
    await call(voidPayment, { params: { id: String(paymentRes.payload._id) } });
    await call(cancelDeal, { params: { id: String(cancelledDeal._id) }, body: {} });

    const res = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    const full = await call(getStatement, { params: { id: String(res.payload._id) } });

    const cancelledDealLines = full.payload.lines.filter((l) => String(l.deal) === String(cancelledDeal._id));
    expect(cancelledDealLines.filter((l) => l.category === "broker_commission")).toHaveLength(0);
    expect(cancelledDealLines.filter((l) => l.category === "company_commission")).toHaveLength(0);

    // The original, un-cancelled deal from setup() still shows its commissions as normal — this isn't a
    // blanket "staged commissions never show" regression, only cancelled ones are excluded.
    expect(res.payload.companyCommission).toBe(30_000);
    expect(res.payload.brokerCommission).toBe(20_000);
  });

  it("a period with no activity for the owner returns a zeroed statement, not an error", async () => {
    const { owner, call } = await setup();
    const res = await call(createDraftStatement, { body: { owner: String(owner._id), periodStart: "2020-01-01", periodEnd: "2020-01-31" } });
    expect(res.payload).toMatchObject({ grossProceeds: 0, companyCommission: 0, brokerCommission: 0, rechargedExpenses: 0, netBalance: 0 });
  });
});

const nextPeriodStart = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const nextPeriodEnd = () => { const d = new Date(); d.setMonth(d.getMonth() + 2, 0); d.setHours(23, 59, 59, 999); return d.toISOString(); };
const midPeriodStart = () => { const d = new Date(); d.setDate(15); d.setHours(0, 0, 0, 0); return d.toISOString(); };

describe("owner statement — overlap guard", () => {
  it("rejects a new period that starts on or before an already-approved statement's end", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    await call(approveStatement, { params: { id: String(draft.payload._id) } });

    await expect(
      call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: midPeriodStart(), periodEnd: nextPeriodEnd() } })
    ).rejects.toThrow(/overlaps the already-approved statement/);
  });

  it("allows a new period that starts strictly after the approved one's end", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    await call(approveStatement, { params: { id: String(draft.payload._id) } });

    const res = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: nextPeriodStart(), periodEnd: nextPeriodEnd() } });
    expect(res.statusCode).toBe(201);
  });

  it("is scoped per-owner, not per-owner+project — an approved all-projects statement also blocks a later per-project one", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), periodStart: periodStart(), periodEnd: periodEnd() } }); // no project = all projects
    await call(approveStatement, { params: { id: String(draft.payload._id) } });

    await expect(
      call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: midPeriodStart(), periodEnd: nextPeriodEnd() } })
    ).rejects.toThrow(/overlaps the already-approved statement/);
  });
});

describe("owner statement — draft replacement and discard", () => {
  it("generating a draft for a different period replaces the owner+project's prior unapproved draft instead of piling up", async () => {
    const { owner, project, call, business } = await setup();
    const first = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: midPeriodStart() } });
    const second = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: nextPeriodStart(), periodEnd: nextPeriodEnd() } });
    expect(second.statusCode).toBe(201);
    expect(String(second.payload._id)).not.toBe(String(first.payload._id));

    const stillThere = await SaleOwnerStatement.findById(first.payload._id).lean();
    expect(stillThere).toBeNull();
    const oldLines = await SaleOwnerStatementLine.find({ statement: first.payload._id }).lean();
    expect(oldLines).toHaveLength(0);

    const list = await call(listStatements, { query: { owner: String(owner._id) } });
    expect(list.payload.data.map((s) => String(s._id))).toEqual([String(second.payload._id)]);
  });

  it("an approved statement is never touched by a sibling draft's replacement cleanup", async () => {
    const { owner, project, call } = await setup();
    const approvedDraft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    await call(approveStatement, { params: { id: String(approvedDraft.payload._id) } });

    await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: nextPeriodStart(), periodEnd: nextPeriodEnd() } });

    const stillApproved = await SaleOwnerStatement.findById(approvedDraft.payload._id).lean();
    expect(stillApproved?.status).toBe("approved");
  });

  it("deletes a draft on request, but refuses to delete an approved one", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });

    const del = await call(deleteDraftStatement, { params: { id: String(draft.payload._id) } });
    expect(del.payload).toMatchObject({ success: true });
    expect(await SaleOwnerStatement.findById(draft.payload._id).lean()).toBeNull();
    expect(await SaleOwnerStatementLine.find({ statement: draft.payload._id }).lean()).toHaveLength(0);

    const draft2 = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    await call(approveStatement, { params: { id: String(draft2.payload._id) } });
    await expect(call(deleteDraftStatement, { params: { id: String(draft2.payload._id) } })).rejects.toThrow(/cannot be deleted/);
  });
});

describe("owner statement — reversing an approval", () => {
  it("flips an approved statement back to draft, preserving its frozen figures, and allows re-approval", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    const approved = await call(approveStatement, { params: { id: String(draft.payload._id) } });
    expect(approved.payload.status).toBe("approved");

    const reversed = await call(reverseStatementApproval, { params: { id: String(draft.payload._id) } });
    expect(reversed.payload).toMatchObject({
      status: "draft",
      grossProceeds: approved.payload.grossProceeds,
      companyCommission: approved.payload.companyCommission,
      netBalance: approved.payload.netBalance,
    });
    expect(reversed.payload.reversedAt).toBeTruthy();

    // Re-approving the reversed draft must work cleanly (it's a normal draft again)
    const reapproved = await call(approveStatement, { params: { id: String(draft.payload._id) } });
    expect(reapproved.payload.status).toBe("approved");
  });

  it("rejects reversing a statement that was never approved", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    await expect(call(reverseStatementApproval, { params: { id: String(draft.payload._id) } })).rejects.toThrow(/Only an approved statement can be reversed/);
  });

  it("a reversed statement no longer blocks a later overlapping period under the overlap guard", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    await call(approveStatement, { params: { id: String(draft.payload._id) } });

    await expect(
      call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: midPeriodStart(), periodEnd: nextPeriodEnd() } })
    ).rejects.toThrow(/overlaps the already-approved statement/);

    await call(reverseStatementApproval, { params: { id: String(draft.payload._id) } });

    const res = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: midPeriodStart(), periodEnd: nextPeriodEnd() } });
    expect(res.statusCode).toBe(201);
  });

  it("the model guard still rejects a reversal save that also sneaks in a change to a frozen field", async () => {
    const { owner, project, call } = await setup();
    const draft = await call(createDraftStatement, { body: { owner: String(owner._id), project: String(project._id), periodStart: periodStart(), periodEnd: periodEnd() } });
    await call(approveStatement, { params: { id: String(draft.payload._id) } });

    const doc = await SaleOwnerStatement.findById(draft.payload._id);
    doc.status = "draft";
    doc.netBalance = 999_999; // attempting to also edit a frozen figure during the reversal
    await expect(doc.save()).rejects.toThrow(/cannot be modified/i);
  });
});

describe("owner outstanding balance", () => {
  it("reflects proceeds minus commissions minus payouts, live — independent of any one statement", async () => {
    const { owner, call } = await setup();
    const before = await call(getOwnerOutstandingBalance, { params: { ownerId: String(owner._id) } });
    expect(before.payload.outstanding).toBe(1_000_000 - 30_000 - 20_000);

    await call(createOwnerPayout, { body: { owner: String(owner._id), amount: 100_000, reference: "EFT-OS-1" } });
    const after = await call(getOwnerOutstandingBalance, { params: { ownerId: String(owner._id) } });
    expect(after.payload.outstanding).toBe(1_000_000 - 30_000 - 20_000 - 100_000);
  });
});
