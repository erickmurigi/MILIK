// M-Pesa C2B → client receipt: matched by client code or invoice number,
// instant SMS acknowledgement, idempotent, unmatched left alone.
import { describe, it, expect, vi, beforeEach } from "vitest";

const sms = vi.hoisted(() => ({ sent: [], masked: [] }));
vi.mock("../../../services/communicationService.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendAdHocSms: vi.fn(async (args) => { sms.sent.push(args); return { messageId: "m1", status: "Success" }; }),
  sendAdHocSmsToMasked: vi.fn(async (args) => { sms.masked.push(args); return { messageId: "m2" }; }),
}));

import Company from "../../../models/Company.js";
import MpesaCollection from "../../../models/MpesaCollection.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientReceipt from "../models/ClientReceipt.js";
import { matchMpesaCollectionToClient, autoMatchClientMpesaCollection, referenceVariants } from "./clientMpesaMatchService.js";
import { reverseClientReceipt } from "./clientReceiptService.js";
import { setupClientsCompany, createPostedInvoice } from "../test/clientsTestKit.js";

const withPaybill = async (company, cashbook) => {
  await Company.updateOne({ _id: company._id }, { $set: { "paymentIntegration.mpesaPaybills": [{ shortCode: "600100", name: "Main", defaultCashbookAccountId: cashbook._id, enabled: true }] } });
};

let counter = 0;
const collection = (business, overrides = {}) => {
  counter += 1;
  return MpesaCollection.create({ business, shortCode: "600100", source: "callback_confirmation", transactionCode: `SKT${counter}XYZ${Date.now() % 100000}`, transactionDate: new Date(), amount: 1500, msisdn: "254712000111", payerName: "JOHN DOE", matchingStatus: "unmatched", ...overrides });
};

describe("client M-Pesa matching", () => {
  beforeEach(() => { sms.sent.length = 0; sms.masked.length = 0; });

  it("normalises the ways payers type references", () => {
    expect(referenceVariants("clt12")).toEqual(expect.arrayContaining(["CLT12", "CLT-12", "CLT-00012"]));
    expect(referenceVariants(" cinv-00345 ")).toEqual(expect.arrayContaining(["CINV-00345", "CINV-345"]));
  });

  it("matches by client code, allocates oldest-first and texts the payer", async () => {
    const { company, business, userId, client, cashbook } = await setupClientsCompany();
    await withPaybill(company, cashbook);
    const older = await createPostedInvoice({ business, client, userId, amount: 1000, issueDate: new Date(Date.now() - 40 * 86400000) });
    const newer = await createPostedInvoice({ business, client, userId, amount: 1000 });
    const code = client.clientCode.replace("-", "").toLowerCase(); // "clt00001"-style
    const row = await collection(business, { accountReference: code });

    const result = await autoMatchClientMpesaCollection(row);
    expect(result.matched).toBe(true);
    expect(result.matchedBy).toBe("client_code");
    expect(result.receipt.source).toBe("mpesa_auto");
    expect(result.receipt.reference).toBe(row.transactionCode);
    expect((await ClientInvoice.findById(older._id).lean()).paidAmount).toBe(1000);
    expect((await ClientInvoice.findById(newer._id).lean()).paidAmount).toBe(500);

    const stored = await MpesaCollection.findById(row._id).lean();
    expect(stored.matchingStatus).toBe("captured");
    expect(stored.metadata.clientReceiptNumber).toBe(result.receipt.receiptNumber);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].phone).toBe("254712000111");
    expect(sms.sent[0].body).toContain(result.receipt.receiptNumber);

    // Idempotent: matching the same payment again returns the same receipt.
    const again = await matchMpesaCollectionToClient({ collectionId: row._id });
    expect(again.alreadyMatched).toBe(true);
    expect(await ClientReceipt.countDocuments({ mpesaCollection: row._id })).toBe(1);
  });

  it("matches by invoice number to that invoice only (excess held as credit), and masked numbers go via Africa's Talking", async () => {
    const { company, business, userId, client, cashbook } = await setupClientsCompany();
    await withPaybill(company, cashbook);
    const older = await createPostedInvoice({ business, client, userId, amount: 1000, issueDate: new Date(Date.now() - 40 * 86400000) });
    const target = await createPostedInvoice({ business, client, userId, amount: 1200 });
    const row = await collection(business, { accountReference: target.invoiceNumber.toLowerCase(), msisdn: "a1b2c3d4e5f6hashed" });

    const result = await matchMpesaCollectionToClient({ collectionId: row._id });
    expect(result.matchedBy).toBe("invoice_number");
    expect((await ClientInvoice.findById(target._id).lean()).status).toBe("paid");
    expect((await ClientInvoice.findById(older._id).lean()).paidAmount).toBe(0);
    expect(result.receipt.unappliedAmount).toBe(300);
    expect(sms.masked).toHaveLength(1);
    expect(sms.sent).toHaveLength(0);
  });

  it("leaves unmatched payments in the queue, and a reversed receipt releases the payment for re-matching", async () => {
    const { company, business, userId, client, cashbook } = await setupClientsCompany();
    await withPaybill(company, cashbook);
    const unknown = await collection(business, { accountReference: "HOUSE 4B" });
    const miss = await autoMatchClientMpesaCollection(unknown);
    expect(miss.matched).toBe(false);
    expect((await MpesaCollection.findById(unknown._id).lean()).matchingStatus).toBe("unmatched");

    // Manual match from the queue.
    const manual = await matchMpesaCollectionToClient({ business, collectionId: unknown._id, clientId: client._id, userId, source: "mpesa_manual", sendSms: false });
    expect(manual.receipt.source).toBe("mpesa_manual");
    expect(manual.receipt.unappliedAmount).toBe(1500);

    await reverseClientReceipt({ business, userId, receiptId: manual.receipt._id, reason: "Wrong client" });
    expect((await MpesaCollection.findById(unknown._id).lean()).matchingStatus).toBe("unmatched");
    const rematch = await matchMpesaCollectionToClient({ business, collectionId: unknown._id, clientId: client._id, sendSms: false });
    expect(rematch.matched).toBe(true);
  });
});
