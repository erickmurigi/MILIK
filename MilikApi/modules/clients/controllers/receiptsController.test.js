// Multi-invoice client receipts: allocation, unapplied credit, WHT, credit
// application, refunds, reversal and reference uniqueness — each checked
// against the invoices AND the GL (every journal must balance).
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientReceipt from "../models/ClientReceipt.js";
import ClientWhtCertificate from "../models/ClientWhtCertificate.js";
import {
  createReceipt,
  getAllocationSuggestions,
  applyCredit,
  reverseAllocation,
  reverseReceipt,
  refundCredit,
  reverseRefund,
  updateWhtCertificate,
  updateChequeStatus,
} from "./receiptsController.js";
import { setupClientsCompany, createPostedInvoice, accountBalance, assertLedgerBalanced } from "../test/clientsTestKit.js";

const day = (offset) => new Date(Date.now() + offset * 86400000);

describe("client receipts", () => {
  it("allocates one receipt across several invoices, holds the excess as unapplied credit, and balances the GL", async () => {
    const { business, user, userId, client, cashbook } = await setupClientsCompany();
    const older = await createPostedInvoice({ business, client, userId, amount: 1000, issueDate: day(-60), dueDate: day(-30) });
    const newer = await createPostedInvoice({ business, client, userId, amount: 2000, issueDate: day(-10), dueDate: day(20) });

    // Suggestion: oldest first, editable.
    const suggestion = await callController(getAllocationSuggestions, { user, query: { clientId: String(client._id), amount: "3500" } });
    const rows = suggestion.payload.data.invoices;
    expect(rows.map((r) => r.invoiceNumber)).toEqual([older.invoiceNumber, newer.invoiceNumber]);
    expect(rows.map((r) => r.suggestedAmount)).toEqual([1000, 2000]);
    expect(suggestion.payload.data.totals.suggestedUnapplied).toBe(500);

    const res = await callController(createReceipt, {
      user,
      body: {
        client: String(client._id),
        amount: 3500,
        method: "bank_transfer",
        reference: "FT-1001",
        cashbookAccountId: String(cashbook._id),
        allocations: rows.map((r) => ({ invoice: String(r._id), amount: r.suggestedAmount })),
      },
    });
    expect(res.statusCode).toBe(201);
    const receipt = res.payload.receipt;
    expect(receipt.receiptNumber).toMatch(/^CR-\d{5}$/);
    expect(receipt.unappliedAmount).toBe(500);
    expect(receipt.allocations).toHaveLength(2);

    const [inv1, inv2] = await Promise.all([ClientInvoice.findById(older._id).lean(), ClientInvoice.findById(newer._id).lean()]);
    expect(inv1.status).toBe("paid");
    expect(inv1.paidAmount).toBe(1000);
    expect(inv2.status).toBe("paid");

    expect(await accountBalance(business, "1110")).toBe(3500);
    expect(await accountBalance(business, "1260")).toBe(0); // 3000 invoiced − 3000 settled
    expect(await accountBalance(business, "2136")).toBe(-500); // credit balance = liability
    expect((await assertLedgerBalanced(business)).unbalanced).toEqual([]);
  });

  it("settles an invoice with cash plus income-tax and VAT withholding, and expects both certificates", async () => {
    const { business, user, userId, client, cashbook } = await setupClientsCompany({
      clientOverrides: { taxBehaviour: { vatWithholdingAgent: true, incomeTaxWhtAgent: true, incomeTaxWhtRate: 5 } },
    });
    // 10,000 + 16% VAT = 11,600. Client withholds 5% IT (500) and 2% VAT (200), pays 10,900.
    const invoice = await createPostedInvoice({ business, client, userId, amount: 10000, vatRate: 16 });

    const suggestion = await callController(getAllocationSuggestions, { user, query: { clientId: String(client._id), amount: "10900" } });
    const row = suggestion.payload.data.invoices[0];
    expect(row.suggestedWhtIncomeTax).toBe(500);
    expect(row.suggestedWhtVat).toBe(200);
    expect(row.suggestedCash).toBe(10900);
    expect(row.suggestedAmount).toBe(11600);

    const res = await callController(createReceipt, {
      user,
      body: {
        client: String(client._id),
        amount: 10900,
        method: "bank_transfer",
        reference: "RTGS-77",
        cashbookAccountId: String(cashbook._id),
        whtIncomeTax: { amount: 500 },
        whtVat: { amount: 200, certificateNo: "VWHT-001" },
        allocations: [{ invoice: String(invoice._id), amount: 11600 }],
      },
    });
    const receipt = res.payload.receipt;
    expect(receipt.unappliedAmount).toBe(0);

    const settled = await ClientInvoice.findById(invoice._id).lean();
    expect(settled.status).toBe("paid");
    expect(settled.paidAmount).toBe(11600);

    expect(await accountBalance(business, "1110")).toBe(10900);
    expect(await accountBalance(business, "1265")).toBe(500);
    expect(await accountBalance(business, "1266")).toBe(200);
    expect(await accountBalance(business, "1260")).toBe(0);
    expect((await assertLedgerBalanced(business)).unbalanced).toEqual([]);

    const certs = await ClientWhtCertificate.find({ receipt: receipt._id }).sort({ type: 1 }).lean();
    expect(certs.map((c) => [c.type, c.status, c.amount])).toEqual([["income_tax", "expected", 500], ["vat", "received", 200]]);

    // Record the income-tax certificate when it arrives.
    const updated = await callController(updateWhtCertificate, { user, params: { certId: String(certs[0]._id) }, body: { certificateNo: "ITW-123", certificateDate: "2026-11-01" } });
    expect(updated.payload.certificate.status).toBe("received");
    const reread = await ClientReceipt.findById(receipt._id).lean();
    expect(reread.whtIncomeTax.certificateNo).toBe("ITW-123");
  });

  it("applies unapplied credit to a later invoice, can undo that application, and refunds the rest", async () => {
    const { business, user, userId, client, cashbook } = await setupClientsCompany();
    const prepaid = await callController(createReceipt, {
      user,
      body: { client: String(client._id), amount: 5000, method: "mobile_money", reference: "QAB12CD34", cashbookAccountId: String(cashbook._id), allocations: [] },
    });
    expect(prepaid.payload.receipt.unappliedAmount).toBe(5000);

    const invoice = await createPostedInvoice({ business, client, userId, amount: 3000 });
    const applied = await callController(applyCredit, { user, body: { clientId: String(client._id), allocations: [{ invoice: String(invoice._id), amount: 3000 }] } });
    expect(applied.payload.data.applied).toBe(3000);
    expect((await ClientInvoice.findById(invoice._id).lean()).status).toBe("paid");
    expect(await accountBalance(business, "2136")).toBe(-2000);
    expect(await accountBalance(business, "1260")).toBe(0);

    // Over-applying more credit than is left is refused.
    const second = await createPostedInvoice({ business, client, userId, amount: 4000 });
    await expect(callController(applyCredit, { user, body: { clientId: String(client._id), allocations: [{ invoice: String(second._id), amount: 2500 }] } }))
      .rejects.toMatchObject({ status: 400 });

    // Undo the application: invoice re-opens, credit comes back.
    const receiptDoc = await ClientReceipt.findById(prepaid.payload.receipt._id).lean();
    const application = receiptDoc.allocations.find((a) => a.kind === "credit_application");
    await callController(reverseAllocation, { user, params: { id: String(receiptDoc._id), allocationId: String(application._id) }, body: { reason: "Applied to wrong invoice" } });
    const reopened = await ClientInvoice.findById(invoice._id).lean();
    expect(reopened.paidAmount).toBe(0);
    expect(["sent", "posted"]).toContain(reopened.status);
    expect((await ClientReceipt.findById(receiptDoc._id).lean()).unappliedAmount).toBe(5000);

    // Refund part of the credit: Dr 2136 / Cr bank.
    const refund = await callController(refundCredit, { user, params: { id: String(receiptDoc._id) }, body: { amount: 1500, method: "bank_transfer", reference: "REFUND-1", cashbookAccountId: String(cashbook._id) } });
    expect(refund.payload.refund.refundNumber).toMatch(/^CRF-/);
    expect(await accountBalance(business, "2136")).toBe(-3500);
    expect(await accountBalance(business, "1110")).toBe(3500);

    // A receipt with a live refund can't be reversed until the refund is.
    await expect(callController(reverseReceipt, { user, params: { id: String(receiptDoc._id) }, body: { reason: "test" } })).rejects.toMatchObject({ status: 400 });
    await callController(reverseRefund, { user, params: { refundId: String(refund.payload.refund._id) }, body: { reason: "Client kept credit" } });
    expect(await accountBalance(business, "2136")).toBe(-5000);
    expect((await assertLedgerBalanced(business)).unbalanced).toEqual([]);
  });

  it("reversal undoes GL, invoice paid amounts, credit applications and WHT certificates", async () => {
    const { business, user, userId, client, cashbook } = await setupClientsCompany();
    const invoice = await createPostedInvoice({ business, client, userId, amount: 1000 });
    const later = await createPostedInvoice({ business, client, userId, amount: 300 });
    const res = await callController(createReceipt, {
      user,
      body: {
        client: String(client._id), amount: 1100, method: "cash", reference: "CASH-9", cashbookAccountId: String(cashbook._id),
        whtIncomeTax: { amount: 50 }, allocations: [{ invoice: String(invoice._id), amount: 1000 }],
      },
    });
    const receiptId = String(res.payload.receipt._id);
    expect(res.payload.receipt.unappliedAmount).toBe(150);
    await callController(applyCredit, { user, params: { id: receiptId }, body: { allocations: [{ invoice: String(later._id), amount: 150 }] } });

    await expect(callController(reverseReceipt, { user, params: { id: receiptId }, body: {} })).rejects.toMatchObject({ status: 400 }); // reason required
    const reversed = await callController(reverseReceipt, { user, params: { id: receiptId }, body: { reason: "Posted to wrong client" } });
    expect(reversed.payload.receipt.status).toBe("reversed");
    expect(reversed.payload.receipt.referenceKey).toBeNull();

    const [inv, inv2] = await Promise.all([ClientInvoice.findById(invoice._id).lean(), ClientInvoice.findById(later._id).lean()]);
    expect(inv.paidAmount).toBe(0);
    expect(inv2.paidAmount).toBe(0);
    for (const code of ["1110", "1265", "2136"]) expect(await accountBalance(business, code)).toBe(0);
    expect(await accountBalance(business, "1260")).toBe(1300);
    expect((await ClientWhtCertificate.findOne({ receipt: receiptId }).lean()).status).toBe("cancelled");
    expect((await assertLedgerBalanced(business)).unbalanced).toEqual([]);

    // The reference is free again once the receipt is reversed.
    const again = await callController(createReceipt, { user, body: { client: String(client._id), amount: 1000, method: "cash", reference: "cash-9", cashbookAccountId: String(cashbook._id) } });
    expect(again.statusCode).toBe(201);
  });

  it("rejects a reference already used by a live receipt (case/space-insensitive) and over-allocation", async () => {
    const { business, user, userId, client, cashbook } = await setupClientsCompany();
    const invoice = await createPostedInvoice({ business, client, userId, amount: 500 });
    await callController(createReceipt, { user, body: { client: String(client._id), amount: 100, method: "bank_transfer", reference: "UIIBC7 DPWP", cashbookAccountId: String(cashbook._id), allocations: [] } });
    await expect(callController(createReceipt, { user, body: { client: String(client._id), amount: 100, method: "bank_transfer", reference: "uiibc7  dpwp ", cashbookAccountId: String(cashbook._id), allocations: [] } }))
      .rejects.toMatchObject({ status: 409 });
    // Allocating more than the invoice owes, or more than the receipt holds.
    await expect(callController(createReceipt, { user, body: { client: String(client._id), amount: 900, method: "cash", cashbookAccountId: String(cashbook._id), allocations: [{ invoice: String(invoice._id), amount: 600 }] } }))
      .rejects.toMatchObject({ status: 400 });
    await expect(callController(createReceipt, { user, body: { client: String(client._id), amount: 100, method: "cash", cashbookAccountId: String(cashbook._id), allocations: [{ invoice: String(invoice._id), amount: 200 }] } }))
      .rejects.toMatchObject({ status: 400 });
    // No cashbook.
    await expect(callController(createReceipt, { user, body: { client: String(client._id), amount: 100, method: "cash" } })).rejects.toMatchObject({ status: 400 });
  });

  it("auto-allocates oldest-first when no allocations are given, and a bounced cheque reverses the receipt", async () => {
    const { business, user, userId, client, cashbook } = await setupClientsCompany();
    const a = await createPostedInvoice({ business, client, userId, amount: 400, issueDate: day(-40), dueDate: day(-10) });
    const b = await createPostedInvoice({ business, client, userId, amount: 400, issueDate: day(-5), dueDate: day(25) });
    const res = await callController(createReceipt, { user, body: { client: String(client._id), amount: 600, method: "cheque", chequeNumber: "000123", cashbookAccountId: String(cashbook._id) } });
    const receipt = res.payload.receipt;
    expect(receipt.chequeStatus).toBe("pending");
    const [ia, ib] = await Promise.all([ClientInvoice.findById(a._id).lean(), ClientInvoice.findById(b._id).lean()]);
    expect(ia.paidAmount).toBe(400);
    expect(ib.paidAmount).toBe(200);
    expect(ib.status).toBe("partial");

    const bounced = await callController(updateChequeStatus, { user, params: { id: String(receipt._id) }, body: { status: "bounced", reason: "Insufficient funds" } });
    expect(bounced.payload.receipt.status).toBe("reversed");
    expect(bounced.payload.receipt.chequeStatus).toBe("bounced");
    expect((await ClientInvoice.findById(a._id).lean()).status).toBe("overdue");
    expect(await accountBalance(business, "1260")).toBe(800);
  });
});
