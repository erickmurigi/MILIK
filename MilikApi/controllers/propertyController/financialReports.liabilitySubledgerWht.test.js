// Liability Sub-Ledger, WHT (2141) tab: a commission-payout's WHT leg uses a composite
// sourceTransactionId ("<commissionId>:payout:<payoutId>"), not a PaymentVoucher id. Before this fix,
// handing that string straight to PaymentVoucher.find({_id:{$in:[...]}}) would throw a CastError and
// 500 the whole report for any company with an agency-remitted commission WHT posting. This confirms
// it no longer throws, the total still includes the commission's WHT, and the row is enriched from the
// commission itself (not left blank) — while a genuine PaymentVoucher-sourced row still resolves too.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { getLiabilitySubledger } from "./financialReports.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";
import SaleAgent from "../../modules/propertySale/models/SaleAgent.js";
import SaleAdvocate from "../../modules/propertySale/models/SaleAdvocate.js";
import SaleProject from "../../modules/propertySale/models/SaleProject.js";
import SaleListing from "../../modules/propertySale/models/SaleListing.js";
import SaleBuyer from "../../modules/propertySale/models/SaleBuyer.js";
import SaleDeal from "../../modules/propertySale/models/SaleDeal.js";
import SaleCommission from "../../modules/propertySale/models/SaleCommission.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import "../../models/ServiceProvider.js"; // registers the model populate("serviceProvider") needs

describe("getLiabilitySubledger — wht tab handles composite (commission-payout) source ids", () => {
  it("includes a property-sale commission's WHT leg without crashing, enriched with commission details, alongside a real voucher row", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, propertyManagement: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const whtAcc = await getAccountByCode(business, "2141");
    const now = new Date();
    const statementPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const statementPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // ── A real PaymentVoucher-sourced WHT entry (existing behavior, must keep working) ──
    const voucher = await PaymentVoucher.create({
      business, voucherNo: "PV-WHT-1", narration: "Test vendor payment", amount: 50_000,
      whtAmount: 2_500, paidDate: new Date(), status: "paid",
      category: "company_operational", dueDate: new Date(),
    });
    await postEntry({
      business, allowUnscoped: true,
      accountId: whtAcc._id, direction: "credit", amount: 2_500,
      sourceTransactionType: "payment_voucher", sourceTransactionId: String(voucher._id),
      transactionDate: voucher.paidDate, statementPeriodStart, statementPeriodEnd,
      category: "EXPENSE_DEDUCTION",
    });

    // ── A property-sale commission's WHT leg, posted with the real composite sourceTransactionId ──
    const advocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-1", fullName: "Jane Advocate", firm: "Jane & Co", phone: "0700000000" });
    const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", assignedAdvocate: advocate._id });
    const listing = await SaleListing.create({ business, listingNumber: "L-1", title: "Plot 1", askingPrice: 1_000_000, project: project._id, unitNumber: "U1" });
    const buyer = await SaleBuyer.create({ business, buyerNumber: "B-1", fullName: "Buyer One", phone: "0711111111", email: "b1@example.com" });
    const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0722222222", commissionRate: 2 });
    const deal = await SaleDeal.create({ business, dealNumber: "DL-1", listing: listing._id, buyer: buyer._id, agent: agent._id, agreedPrice: 1_000_000 });

    const payoutId = new mongoose.Types.ObjectId();
    const commission = await SaleCommission.create({
      business, commissionNumber: "COM-00001", deal: deal._id, agent: agent._id, listing: listing._id,
      saleAmount: 1_000_000, commissionRate: 2, commissionAmount: 20_000, status: "paid",
      whtAmount: 1_000, netAmount: 19_000,
      payouts: [{ _id: payoutId, amount: 20_000, whtAmount: 1_000, netAmount: 19_000, method: "bank_transfer", date: new Date(), source: "advocate_trust", whtHandledBy: "agent" }],
    });
    const sourceTransactionId = `${commission._id}:payout:${payoutId}`;
    await postEntry({
      business, allowUnscoped: true,
      accountId: whtAcc._id, direction: "credit", amount: 1_000,
      sourceTransactionType: "property_sale_commission_payout", sourceTransactionId,
      transactionDate: now, statementPeriodStart, statementPeriodEnd,
      category: "PROPERTY_SALE_COMMISSION_PAYOUT",
    });

    const res = await callController(getLiabilitySubledger, {
      query: { business: String(business), tab: "wht" },
      user: { company: business },
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload.total).toBe(3_500); // 2,500 (voucher) + 1,000 (commission)

    const allRows = res.payload.groups.flatMap((g) => g.rows);
    const voucherRow = allRows.find((r) => r.sourceId === String(voucher._id));
    expect(voucherRow).toMatchObject({ voucherNo: "PV-WHT-1", whtBalance: 2_500 });

    const commissionRow = allRows.find((r) => r.sourceId === sourceTransactionId);
    expect(commissionRow).toMatchObject({
      voucherNo: "COM-00001",
      vendor: "Jane Agent",
      property: "Plot 1",
      grossAmount: 20_000,
      whtBalance: 1_000,
    });
  });
});
