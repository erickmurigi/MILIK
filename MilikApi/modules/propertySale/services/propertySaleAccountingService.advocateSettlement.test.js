// Advocate trust settlement — full worked-example reconciliation (the "Plot 10 / Jane / Kamau & Co"
// numbers from the advocate-trust-settlement design conversation): a 1,000,000 deal, 30,000 company
// commission, 20,000 broker commission minus 5% WHT (1,000), 15,000 recoverable owner expense, and a
// 935,000 net owner payout (= 1,000,000 - 30,000 - 20,000 - 15,000) — all settled by the advocate
// directly out of trust funds. Exercises postPropertySaleCommissionPayout (source/whtHandledBy),
// postSaleAdvocateRemittance (now always a pure cash entry) + postRecoverableExpenseSettlement (the
// separate non-cash reclassification) and the new postSaleOwnerPayout together, for both whtHandledBy
// variants, and traces every account's true closing balance against its correct reconciliation
// invariant: 1314 / 1313 / 2180 each reach true zero, and 2185 closes at exactly the deal's agreedPrice
// (1,000,000) — every shilling of the price ends up classified as company commission, OR broker
// commission, OR recoverable-expense recovery, OR the owner's net cash payout, each debiting 2185 once.
import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { createTestCompany, createTestChartOfAccounts } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import SaleAdvocateRemittance from "../models/SaleAdvocateRemittance.js";
import SaleOwnerPayout from "../models/SaleOwnerPayout.js";
import {
  postPropertySalePaymentLedger,
  postPropertySaleOwnerCommissionTierRelease,
  postPropertySaleCommissionPayout,
  postSaleAdvocateRemittance,
  reverseSaleAdvocateRemittance,
  postSaleOwnerPayout,
  resolvePSAccount,
} from "./propertySaleAccountingService.js";
import { postEntries } from "../../../services/ledgerPostingService.js";
import { round2 } from "../../../utils/math.js";

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;

// Net balance (debit - credit) of every entry posted to one account, for one business — matching the
// same status convention chartAccountAggregationService.js uses for a real account balance: a
// "reversed" original entry still counts (it's flagged for audit, not removed), and its mirrored
// reversing entry (opposite direction) counts too, so together an original+reversal pair always nets
// to zero. Only "void"/"draft" are excluded.
const netBalanceOf = async (business, code) => {
  const acc = await getAccountByCode(business, code);
  const rows = await FinancialLedgerEntry.find({ business, accountId: acc._id, status: { $nin: ["void", "draft"] } }).lean();
  return round2(rows.reduce((s, r) => s + Number(r.debit || 0) - Number(r.credit || 0), 0));
};

// Live (not-yet-reversed, not itself a reversal) legs for one posting — i.e. what the idempotency
// check at the top of every posting function in propertySaleAccountingService.js itself looks for.
const legsFor = async (business, sourceTransactionType, sourceTransactionId) =>
  FinancialLedgerEntry.find({ business, sourceTransactionType, sourceTransactionId: String(sourceTransactionId), status: { $ne: "reversed" }, category: { $ne: "REVERSAL" } }).lean();

// Runs the full Plot 10 worked example and returns the ids/business needed for assertions.
const runWorkedExample = async (whtHandledBy) => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const business = company._id;
  const userId = oid();
  const deal = oid();
  const owner = await SaleOwner.create({ business, ownerNumber: `OWN-${++seq}`, fullName: "Jane Owner", phone: "0722000111" });
  const advocate = oid();

  // A. Buyer pays the full 1,000,000 price into the advocate's trust account.
  const payment = { _id: oid(), paymentNumber: `PAY-${++seq}`, amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust", paymentDate: new Date() };
  await postPropertySalePaymentLedger({ businessId: business, payment, userId });

  // B. Company's own commission (30,000), immediate-release — Dr 2185 / Cr 4430.
  const ownerCommission = await SaleOwnerCommission.create({
    business, commissionNumber: `OC-${++seq}`, deal, owner: owner._id, saleAmount: 1_000_000,
    commissionRate: 3, commissionAmount: 30_000, status: "approved",
  });
  const ownerTier = { _id: oid(), thresholdPct: 100, releasePct: 100, amount: 30_000, accruedAt: new Date() };
  await postPropertySaleOwnerCommissionTierRelease({ businessId: business, ownerCommission, tierRelease: ownerTier, userId });

  // C. Broker commission (20,000 gross, 5% WHT = 1,000, net 19,000), paid by the advocate out of trust.
  const commission = await SaleCommission.create({
    business, commissionNumber: `BC-${++seq}`, deal, agent: oid(), owner: owner._id, saleAmount: 1_000_000,
    commissionRate: 2, commissionAmount: 20_000, whtRate: 5, whtAmount: 1_000, netAmount: 19_000,
    status: "approved", payoutSource: "advocate_trust",
  });
  const commissionPayout = { _id: oid(), amount: 20_000, whtAmount: 1_000, netAmount: 19_000, method: "bank_transfer", date: new Date(), source: "advocate_trust" };
  await postPropertySaleCommissionPayout({ businessId: business, commission, userId, payout: commissionPayout, whtHandledBy });

  // D. Simulates the company having already paid a recoverable owner expense (15,000) on the owner's
  // behalf — i.e. the GL state a "sale_owner_expense" PaymentVoucher leaves behind (Dr 1313 / Cr cashbook),
  // which is covered by its own dedicated tests (paymentVoucherSaleOwner.test.js) and not re-tested here.
  const recoverableAcc = await resolvePSAccount(business, "1313");
  const simCashbookAcc = await resolvePSAccount(business, "1311");
  const simVoucherId = oid();
  await postEntries([
    { business, sourceTransactionType: "payment_voucher", sourceTransactionId: String(simVoucherId), transactionDate: new Date(), statementPeriodStart: new Date(0), statementPeriodEnd: new Date(), journalGroupId: oid(), category: "EXPENSE_DEDUCTION", createdBy: userId, allowUnscoped: true, accountId: recoverableAcc._id, direction: "debit", amount: 15_000, notes: "Simulated recoverable owner expense" },
    { business, sourceTransactionType: "payment_voucher", sourceTransactionId: String(simVoucherId), transactionDate: new Date(), statementPeriodStart: new Date(0), statementPeriodEnd: new Date(), journalGroupId: oid(), category: "EXPENSE_DEDUCTION", createdBy: userId, allowUnscoped: true, accountId: simCashbookAcc._id, direction: "credit", amount: 15_000, notes: "Simulated recoverable owner expense" },
  ]);

  // E. Advocate remittance — forwards what's left in trust after the broker's share: the recoverable
  // expense recovery (15,000, routed to 1313) plus commission-cash (company's 30,000 commission, plus
  // the withheld 1,000 WHT *only* when the agent — not the advocate — is the one remitting it to KRA).
  const whtForward = whtHandledBy === "agent" ? 1_000 : 0;
  const remittanceAmount = round2(15_000 + 30_000 + whtForward);
  const appliedTo = [
    { category: "recoverable_expense", refId: simVoucherId, amount: 15_000 },
    { category: "owner_commission_cash", refId: null, amount: round2(30_000 + whtForward) },
  ];
  const remittance = await SaleAdvocateRemittance.create({
    business, remittanceNumber: `REM-${++seq}`, advocate, deal, amount: remittanceAmount, appliedTo,
  });
  await postSaleAdvocateRemittance({ businessId: business, remittance, userId, appliedTo });

  // F. Owner's net payout — 935,000 = 1,000,000 - 30,000 (company commission) - 20,000 (broker, gross)
  // - 15,000 (recoverable expense) — paid directly by the advocate out of trust.
  const payout = await SaleOwnerPayout.create({
    business, payoutNumber: `OPY-${++seq}`, owner: owner._id, deal, amount: 935_000, source: "advocate_trust", advocate,
  });
  await postSaleOwnerPayout({ businessId: business, payout, userId });

  return { business, deal, owner, commission, commissionPayout, remittance, payout, remittanceAmount };
};

describe("advocate trust settlement — full worked example (Plot 10 / Jane / Kamau & Co)", () => {
  it.each(["agent", "advocate"])("whtHandledBy=%s — 1314/1313/2180 reach true zero; 2185 closes at the deal's agreedPrice; the WHT leg is present only for the agent variant", async (whtHandledBy) => {
    const { business, commission, commissionPayout, remittance, payout } = await runWorkedExample(whtHandledBy);

    // 2180 Agent Commission Payable: accrued 20,000 (credit) by the accrual, cleared 20,000 (debit) by
    // the payout, regardless of source/whtHandledBy — the payable's debit side is always the full gross
    // commissionAmount. Genuinely zero.
    expect(await netBalanceOf(business, "2180")).toBe(0);

    // 1313 Owner Expense Recoverable: debited 15,000 by the simulated voucher, credited back exactly
    // 15,000 by the separate postRecoverableExpenseSettlement entry (Dr 2185 / Cr 1313). Genuinely zero.
    expect(await netBalanceOf(business, "1313")).toBe(0);

    // The commission payout's own 3 (agent) or 2 (advocate) legs balance on their own.
    const payoutLegs = await legsFor(business, "property_sale_commission_payout", `${commission._id}:payout:${commissionPayout._id}`);
    const wht = await getAccountByCode(business, "2141").catch(() => null);
    if (whtHandledBy === "agent") {
      expect(payoutLegs).toHaveLength(3);
      expect(payoutLegs.find((l) => String(l.accountId) === String(wht._id))).toMatchObject({ direction: "credit", credit: 1_000 });
      expect(payoutLegs.reduce((s, l) => s + Number(l.credit || 0), 0)).toBe(19_000 + 1_000);
    } else {
      // advocate self-remits: no 2141 leg at all, and the full gross 20,000 goes to 1314 in one credit.
      expect(payoutLegs).toHaveLength(2);
      expect(payoutLegs.find((l) => l.direction === "credit")).toMatchObject({ credit: 20_000 });
    }
    expect(payoutLegs.reduce((s, l) => s + Number(l.debit || 0), 0)).toBe(payoutLegs.reduce((s, l) => s + Number(l.credit || 0), 0));

    // The remittance's own cash legs balance on their own too (Dr cashbook == Cr 1314, both the full
    // remittance amount — no split into 1313 any more; that recognition is now the separate entry below).
    const remittanceLegs = await legsFor(business, "property_sale_advocate_remittance", remittance._id);
    expect(remittanceLegs).toHaveLength(2);
    expect(remittanceLegs.reduce((s, l) => s + Number(l.debit || 0), 0)).toBe(remittanceLegs.reduce((s, l) => s + Number(l.credit || 0), 0));
    const remittanceCredit = remittanceLegs.find((l) => l.direction === "credit");
    const trustAcc = await getAccountByCode(business, "1314");
    expect(String(remittanceCredit.accountId)).toBe(String(trustAcc._id));

    // The separate recoverable-expense settlement entry (Dr 2185 / Cr 1313, 15,000) balances on its own.
    const settlementLegs = await legsFor(business, "property_sale_recoverable_expense_settlement", `${remittance._id}:recoverable:${remittance.appliedTo[0].refId}`);
    expect(settlementLegs).toMatchObject([
      { direction: "debit", debit: 15_000 },
      { direction: "credit", credit: 15_000 },
    ]);

    // The owner payout's own legs balance (Dr 2185 == Cr 1314, both 935,000).
    const payoutOwnerLegs = await legsFor(business, "property_sale_owner_payout", payout._id);
    expect(payoutOwnerLegs).toMatchObject([
      { direction: "debit", debit: 935_000 },
      { direction: "credit", credit: 935_000 },
    ]);

    // 1314 Advocate Trust Receivable: collected 1,000,000, fully cleared — the commission payout
    // (19,000 or 20,000), the remittance (now always its full cash amount: 46,000 or 45,000), and the
    // owner payout (935,000) sum to exactly 1,000,000 in both variants. True zero.
    expect(await netBalanceOf(business, "1314")).toBe(0);

    // 2185 Owner Clearing: debited once for each of company commission (30,000), broker commission
    // (20,000), the recoverable-expense settlement (15,000), and the owner's net payout (935,000) — every
    // shilling of the deal's 1,000,000 agreedPrice is classified exactly once. Closes at agreedPrice,
    // not zero — 2185 is a one-directional recognition/offset account, not a clears-to-zero one (nothing
    // anywhere credits it for proceeds; proceeds credit 4410 instead — pre-existing, unchanged, out of
    // scope for this batch). The real reconciliation signature for this account is "closes at agreedPrice".
    expect(await netBalanceOf(business, "2185")).toBe(1_000_000);
  });

  it("legacy call with no appliedTo still credits 1314 for the full remittance amount — byte-identical to pre-existing behavior", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const userId = oid();
    const advocate = oid();

    const remittance = await SaleAdvocateRemittance.create({ business, remittanceNumber: "LEGACY-1", advocate, amount: 50_000 });
    await postSaleAdvocateRemittance({ businessId: business, remittance, userId });

    const legs = await legsFor(business, "property_sale_advocate_remittance", remittance._id);
    expect(legs).toHaveLength(2);
    const trustAcc = await getAccountByCode(business, "1314");
    const credit = legs.find((l) => l.direction === "credit");
    expect(String(credit.accountId)).toBe(String(trustAcc._id));
    expect(credit.credit).toBe(50_000);

    // 1313 must be completely untouched — no recoverable-expense split was requested.
    const recoverableAcc = await getAccountByCode(business, "1313").catch(() => null);
    if (recoverableAcc) {
      const stray = await FinancialLedgerEntry.find({ business, accountId: recoverableAcc._id }).lean();
      expect(stray.length).toBe(0);
    }
  });

  it("reversing a remittance reverses both its cash leg and every recoverable-expense settlement leg", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const userId = oid();
    const advocate = oid();
    const refId = oid();

    const appliedTo = [
      { category: "recoverable_expense", refId, amount: 5_000 },
      { category: "owner_commission_cash", refId: null, amount: 10_000 },
    ];
    const remittance = await SaleAdvocateRemittance.create({ business, remittanceNumber: "REV-1", advocate, amount: 15_000, appliedTo });
    await postSaleAdvocateRemittance({ businessId: business, remittance, userId, appliedTo });

    expect((await legsFor(business, "property_sale_advocate_remittance", remittance._id)).length).toBe(2);
    expect((await legsFor(business, "property_sale_recoverable_expense_settlement", `${remittance._id}:recoverable:${refId}`)).length).toBe(2);

    await reverseSaleAdvocateRemittance({ businessId: business, remittance, userId, reason: "test reversal" });

    const cashRows = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_advocate_remittance", sourceTransactionId: String(remittance._id) }).lean();
    const settlementRows = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_recoverable_expense_settlement", sourceTransactionId: `${remittance._id}:recoverable:${refId}` }).lean();
    expect(cashRows.length).toBe(4); // 2 original (now status "reversed") + 2 reversing (category "REVERSAL")
    expect(settlementRows.length).toBe(4);
    expect(cashRows.filter((r) => r.status === "reversed").length).toBe(2);
    expect(cashRows.filter((r) => r.category === "REVERSAL").length).toBe(2);
    expect(settlementRows.filter((r) => r.status === "reversed").length).toBe(2);
    expect(settlementRows.filter((r) => r.category === "REVERSAL").length).toBe(2);
    // No "live, not-yet-reversed, original" leg remains for either source type — matches the exact
    // idempotency filter every posting function in this file itself uses before re-posting.
    const liveOriginal = (rows) => rows.filter((r) => r.status !== "reversed" && r.category !== "REVERSAL");
    expect(liveOriginal(cashRows).length).toBe(0);
    expect(liveOriginal(settlementRows).length).toBe(0);

    // Net effect across both account groups is back to zero.
    expect(await netBalanceOf(business, "1314")).toBe(0);
    expect(await netBalanceOf(business, "1313")).toBe(0);
    expect(await netBalanceOf(business, "2185")).toBe(0);
  });

  it("company_cashbook commission payout is unaffected by source/whtHandledBy defaults — pure regression check", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const userId = oid();
    const bank = await resolvePSAccount(business, "1311");

    const commission = await SaleCommission.create({
      business, commissionNumber: "BC-REG-1", deal: oid(), agent: oid(), saleAmount: 1_000_000,
      commissionRate: 2, commissionAmount: 20_000, whtRate: 5, whtAmount: 1_000, netAmount: 19_000, status: "approved",
    });
    // No source/whtHandledBy passed at all — defaults must reproduce today's exact posting.
    const commissionPayout = { _id: oid(), amount: 20_000, whtAmount: 1_000, netAmount: 19_000, method: "bank_transfer", date: new Date(), cashbook: bank._id };
    await postPropertySaleCommissionPayout({ businessId: business, commission, userId, payout: commissionPayout });

    const legs = await legsFor(business, "property_sale_commission_payout", `${commission._id}:payout:${commissionPayout._id}`);
    expect(legs).toHaveLength(3);
    const wht = await getAccountByCode(business, "2141");
    expect(legs.find((l) => String(l.accountId) === String(bank._id))).toMatchObject({ direction: "credit", credit: 19_000 });
    expect(legs.find((l) => String(l.accountId) === String(wht._id))).toMatchObject({ direction: "credit", credit: 1_000 });
  });
});
