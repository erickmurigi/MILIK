// Deal-scoped advocate trust balance (closes gap #1 of the advocate-trust-settlement phase): an
// advocate's trust funds are tracked per DEAL, not per advocate, so one deal's disbursement can
// never draw against money actually collected for a different deal. Pure service-level tests —
// documents are created directly against the models (no controllers exist yet for the
// disbursement actions that will call this in Batch 2).
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { createTestCompany } from "../../../test/factories.js";
import SalePayment from "../models/SalePayment.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerPayout from "../models/SaleOwnerPayout.js";
import SaleOwner from "../models/SaleOwner.js";
import { dealAdvocateTrustBalance } from "./dealProgress.js";

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;
const nextPaymentNumber = () => `TP-${++seq}`;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true } });
  return { business: company._id };
};

describe("dealAdvocateTrustBalance", () => {
  it("collected (advocate_trust payments) minus disbursed (commission payout + owner payout), for one deal", async () => {
    const { business } = await setup();
    const deal = oid();

    await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal, amount: 300_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });

    // payoutSource alone is NOT what dealAdvocateTrustBalance checks — it only reflects whichever
    // payout tranche was recorded LAST (a commission can be settled partly from trust, partly from the
    // company cashbook), so the real signal is each payouts[] entry's own `source`, exactly like
    // commissionsController.js's updateCommissionStatus actually populates it.
    await SaleCommission.create({
      business, commissionNumber: "C-1", deal, agent: oid(), saleAmount: 1_000_000, commissionRate: 2,
      commissionAmount: 20_000, status: "paid", payoutSource: "advocate_trust", paidOutAmount: 20_000,
      payouts: [{ amount: 20_000, whtAmount: 0, netAmount: 20_000, method: "bank_transfer", date: new Date(), source: "advocate_trust" }],
    });

    const owner = await SaleOwner.create({ business, ownerNumber: "OWN-1", fullName: "John Mwangi" });
    await SaleOwnerPayout.create({ business, payoutNumber: "OPY-1", owner: owner._id, deal, amount: 50_000, source: "advocate_trust" });

    const balance = await dealAdvocateTrustBalance(business, deal);
    expect(balance).toMatchObject({ collected: 300_000, disbursed: 20_000 + 50_000, available: 300_000 - 70_000 });
  });

  it("sums only the trust-sourced tranche of a commission paid across mixed sources — the top-level payoutSource reflects only the LAST tranche and must never be trusted alone", async () => {
    const { business } = await setup();
    const deal = oid();

    await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal, amount: 200_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });

    // Two tranches: 100,000 genuinely drawn from trust, then 100,000 from the company cashbook (the
    // commission's own top-level payoutSource ends up "company_cashbook" — the LAST tranche's source —
    // even though half of it really did leave this deal's trust pool).
    await SaleCommission.create({
      business, commissionNumber: "C-MIXED", deal, agent: oid(), saleAmount: 1_000_000, commissionRate: 20,
      commissionAmount: 200_000, status: "paid", payoutSource: "company_cashbook", paidOutAmount: 200_000,
      payouts: [
        { amount: 100_000, whtAmount: 0, netAmount: 100_000, method: "bank_transfer", date: new Date(), source: "advocate_trust" },
        { amount: 100_000, whtAmount: 0, netAmount: 100_000, method: "bank_transfer", date: new Date(), source: "company_cashbook" },
      ],
    });

    const balance = await dealAdvocateTrustBalance(business, deal);
    // Only the 100,000 advocate_trust tranche left this deal's trust pool — not the full 200,000
    // commissionAmount, and not 0 (which matching on the stale top-level payoutSource would give).
    expect(balance).toMatchObject({ collected: 200_000, disbursed: 100_000, available: 100_000 });
  });

  it("segregates trust funds between two deals under the same advocate — a payout against one deal never reduces the other's available balance", async () => {
    const { business } = await setup();
    const dealA = oid();
    const dealB = oid();

    await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal: dealA, amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });
    await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal: dealB, amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });

    // A large owner payout scoped to deal A only
    const owner = await SaleOwner.create({ business, ownerNumber: "OWN-SEG", fullName: "Segregation Owner" });
    await SaleOwnerPayout.create({ business, payoutNumber: "OPY-A", owner: owner._id, deal: dealA, amount: 400_000, source: "advocate_trust" });

    const balanceA = await dealAdvocateTrustBalance(business, dealA);
    const balanceB = await dealAdvocateTrustBalance(business, dealB);

    expect(balanceA).toMatchObject({ collected: 500_000, disbursed: 400_000, available: 100_000 });
    // Deal B's full collection is still available — it must not have been drawn down by deal A's payout
    expect(balanceB).toMatchObject({ collected: 100_000, disbursed: 0, available: 100_000 });
  });

  it("ignores a direct (non advocate_trust) payment and a company_cashbook-sourced commission", async () => {
    const { business } = await setup();
    const deal = oid();

    await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal, amount: 200_000, paymentType: "installment", collectionMethod: "direct", status: "paid" });
    await SaleCommission.create({
      business, commissionNumber: "C-2", deal, agent: oid(), saleAmount: 1_000_000, commissionRate: 2,
      commissionAmount: 20_000, status: "paid", payoutSource: "company_cashbook", paidOutAmount: 20_000,
      payouts: [{ amount: 20_000, whtAmount: 0, netAmount: 20_000, method: "bank_transfer", date: new Date(), source: "company_cashbook" }],
    });

    const balance = await dealAdvocateTrustBalance(business, deal);
    expect(balance).toMatchObject({ collected: 0, disbursed: 0, available: 0 });
  });

  it("ignores a pending (not yet paid) advocate_trust commission — it hasn't actually left the trust pool yet", async () => {
    const { business } = await setup();
    const deal = oid();

    await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal, amount: 300_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });
    await SaleCommission.create({
      business, commissionNumber: "C-3", deal, agent: oid(), saleAmount: 1_000_000, commissionRate: 2,
      commissionAmount: 20_000, status: "approved", payoutSource: "advocate_trust",
    });

    const balance = await dealAdvocateTrustBalance(business, deal);
    expect(balance).toMatchObject({ collected: 300_000, disbursed: 0, available: 300_000 });
  });

  it("counts an owner payout's cgtAmount as disbursed too — CGT withheld still left the trust", async () => {
    const { business } = await setup();
    const deal = oid();

    await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal, amount: 300_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });
    const owner = await SaleOwner.create({ business, ownerNumber: "OWN-CGT", fullName: "Jane Owner" });
    await SaleOwnerPayout.create({ business, payoutNumber: "OPY-CGT", owner: owner._id, deal, amount: 180_000, cgtAmount: 20_000, source: "advocate_trust" });

    const balance = await dealAdvocateTrustBalance(business, deal);
    expect(balance).toMatchObject({ collected: 300_000, disbursed: 200_000, available: 100_000 });
  });

  it("a deal with no activity at all returns a zeroed balance, not an error", async () => {
    const { business } = await setup();
    const balance = await dealAdvocateTrustBalance(business, oid());
    expect(balance).toMatchObject({ collected: 0, disbursed: 0, available: 0 });
  });

  describe("combined multi-deal payout (allocations[])", () => {
    it("only counts THIS deal's own slice of a combined payout toward its disbursed total — never the other deals' slices", async () => {
      const { business } = await setup();
      const dealA = oid();
      const dealB = oid();
      const dealC = oid(); // untouched by the payout — must stay fully available

      await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal: dealA, amount: 300_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });
      await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal: dealB, amount: 200_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });
      await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal: dealC, amount: 150_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });

      const owner = await SaleOwner.create({ business, ownerNumber: "OWN-COMBO", fullName: "Combo Owner" });
      // One combined payout, deal: null, drawing 120,000 from dealA and 80,000 from dealB.
      await SaleOwnerPayout.create({
        business, payoutNumber: "OPY-COMBO", owner: owner._id, amount: 200_000, source: "advocate_trust",
        allocations: [{ deal: dealA, amount: 120_000 }, { deal: dealB, amount: 80_000 }],
      });

      const balanceA = await dealAdvocateTrustBalance(business, dealA);
      const balanceB = await dealAdvocateTrustBalance(business, dealB);
      const balanceC = await dealAdvocateTrustBalance(business, dealC);
      expect(balanceA).toMatchObject({ collected: 300_000, disbursed: 120_000, available: 180_000 });
      expect(balanceB).toMatchObject({ collected: 200_000, disbursed: 80_000, available: 120_000 });
      expect(balanceC).toMatchObject({ collected: 150_000, disbursed: 0, available: 150_000 });
    });

    it("a legacy single-deal payout (deal set, no allocations) and a combined payout both correctly reduce their own deals when they coexist", async () => {
      const { business } = await setup();
      const dealA = oid();
      const dealB = oid();

      await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal: dealA, amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });
      await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal: dealB, amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });

      const owner = await SaleOwner.create({ business, ownerNumber: "OWN-MIX", fullName: "Mixed Owner" });
      // Legacy single-deal payout against dealA.
      await SaleOwnerPayout.create({ business, payoutNumber: "OPY-LEGACY", owner: owner._id, deal: dealA, amount: 40_000, source: "advocate_trust" });
      // A LATER combined payout also touching dealA (its remaining balance) plus dealB.
      await SaleOwnerPayout.create({
        business, payoutNumber: "OPY-COMBO-2", owner: owner._id, amount: 110_000, source: "advocate_trust",
        allocations: [{ deal: dealA, amount: 60_000 }, { deal: dealB, amount: 50_000 }],
      });

      const balanceA = await dealAdvocateTrustBalance(business, dealA);
      const balanceB = await dealAdvocateTrustBalance(business, dealB);
      // dealA: 100,000 collected - 40,000 (legacy) - 60,000 (combo slice) = 0 available, not negative,
      // not double-counted as 100,000 disbursed from each payout independently.
      expect(balanceA).toMatchObject({ collected: 100_000, disbursed: 100_000, available: 0 });
      expect(balanceB).toMatchObject({ collected: 100_000, disbursed: 50_000, available: 50_000 });
    });

    it("a cancelled combined payout no longer counts toward any deal's disbursed total", async () => {
      const { business } = await setup();
      const dealA = oid();
      await SalePayment.create({ business, paymentNumber: nextPaymentNumber(), deal: dealA, amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust", status: "paid" });
      const owner = await SaleOwner.create({ business, ownerNumber: "OWN-CANCEL", fullName: "Cancelled Owner" });
      await SaleOwnerPayout.create({
        business, payoutNumber: "OPY-CANCEL", owner: owner._id, amount: 50_000, source: "advocate_trust",
        status: "cancelled", allocations: [{ deal: dealA, amount: 50_000 }],
      });

      const balance = await dealAdvocateTrustBalance(business, dealA);
      expect(balance).toMatchObject({ collected: 100_000, disbursed: 0, available: 100_000 });
    });
  });
});
