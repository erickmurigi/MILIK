// Client master data: KRA PIN validation, one-phone rule, duplicate
// detection, and the upgraded summary (balance/overdue/credit/MRR/unapplied/WHT).
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import Client from "../models/Client.js";
import ClientContract from "../models/ClientContract.js";
import { createClient, updateClient, checkDuplicateClients, getClientSummary } from "./clientsController.js";
import { createReceipt } from "./receiptsController.js";
import { validateKraPin, normalizeClientPhone, nameSimilarity } from "../services/clientValidation.js";
import { assertClientCreditOk } from "../services/clientCreditControlService.js";
import { setupClientsCompany, createPostedInvoice } from "../test/clientsTestKit.js";

describe("client master data", () => {
  it("validates KRA PIN shape, uppercases it, and warns on an unusual prefix", () => {
    expect(validateKraPin("p051234567x", "company")).toEqual({ value: "P051234567X", warning: "" });
    expect(validateKraPin("A123456789B", "individual").warning).toBe("");
    expect(validateKraPin("A123456789B", "company").warning).toMatch(/normally start with 'P'/);
    expect(validateKraPin("P05123456X").error).toBeTruthy(); // 8 digits
    expect(validateKraPin("1234567890").error).toBeTruthy();
    expect(validateKraPin("-")).toEqual({ value: "" });
  });

  it("keeps one phone number per record and treats - as none", () => {
    expect(normalizeClientPhone("+254 712 345 678")).toEqual({ value: "0712345678" });
    expect(normalizeClientPhone("-")).toEqual({ value: "" });
    expect(normalizeClientPhone("0712345678 / 0722000000").error).toBeTruthy();
    expect(normalizeClientPhone("020 2345678")).toEqual({ value: "020 2345678" });
  });

  it("rejects invalid and duplicate PINs on create, and two numbers in one phone field", async () => {
    const { user } = await setupClientsCompany();
    await expect(callController(createClient, { user, body: { name: "Bad Pin Ltd", taxPin: "P12345" } })).rejects.toMatchObject({ status: 400 });
    await expect(callController(createClient, { user, body: { name: "Two Phones Ltd", phone: "0712345678, 0722345678" } })).rejects.toMatchObject({ status: 400 });

    const created = await callController(createClient, {
      user,
      body: {
        name: "Kilimo Traders Ltd", taxPin: "p051234567q", clientType: "company", phone: "-",
        terms: { creditLimit: 50000, paymentTermsDays: 14 },
        taxBehaviour: { incomeTaxWhtAgent: true, incomeTaxWhtRate: 5 },
        contactPersons: [{ name: "Jane", email: "jane@kilimo.test", phone: "0711000111", receivesInvoices: "to" }],
        tags: "Retainer, VIP, vip",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.payload.client.taxPin).toBe("P051234567Q");
    expect(created.payload.client.phone).toBe("");
    expect(created.payload.client.tags).toEqual(["retainer", "vip"]);
    expect(created.payload.client.contactPersons[0].receivesInvoices).toBe("to");

    await expect(callController(createClient, { user, body: { name: "Kilimo Traders (dup)", taxPin: "P051234567Q" } })).rejects.toMatchObject({ status: 409 });

    // An older form that doesn't send the new fields must not wipe them.
    const updated = await callController(updateClient, { user, params: { id: String(created.payload.client._id) }, body: { name: "Kilimo Traders Limited", taxPin: "P051234567Q" } });
    expect(updated.payload.client.terms.creditLimit).toBe(50000);
    expect(updated.payload.client.taxBehaviour.incomeTaxWhtAgent).toBe(true);
  });

  it("finds likely duplicates by name similarity, PIN, phone variants and email", async () => {
    const { user, business } = await setupClientsCompany();
    await Client.create({ business, name: "ACME Limited", clientCode: "CLT-90001", taxPin: "P051111111A", phone: "0722111222", email: "accounts@acme.co.ke" });
    await Client.create({ business, name: "Unrelated Bakery", clientCode: "CLT-90002" });

    expect(nameSimilarity("Acme Ltd", "ACME Limited")).toBe(1);

    const byName = await callController(checkDuplicateClients, { user, query: { name: "Acme Ltd." } });
    expect(byName.payload.matches.map((m) => m.client.clientCode)).toContain("CLT-90001");
    expect(byName.payload.matches.find((m) => m.client.clientCode === "CLT-90001").reasons).toContain("name");

    const byPhone = await callController(checkDuplicateClients, { user, query: { phone: "+254 722 111 222" } });
    expect(byPhone.payload.matches[0].reasons).toEqual(["phone"]);

    const byPinAndEmail = await callController(checkDuplicateClients, { user, query: { taxPin: "p051111111a", email: "Accounts@Acme.co.ke", name: "Something else" } });
    expect(byPinAndEmail.payload.hasStrongMatch).toBe(true);
    expect(byPinAndEmail.payload.matches[0].reasons).toEqual(expect.arrayContaining(["taxPin", "email"]));

    const none = await callController(checkDuplicateClients, { user, query: { name: "Zebra Logistics" } });
    expect(none.payload.matches).toEqual([]);
  });

  it("summarises balance, overdue, credit use, MRR, unapplied credit, last payment and open WHT", async () => {
    const { business, user, userId, client, cashbook } = await setupClientsCompany({ clientOverrides: { terms: { creditLimit: 3000 } } });
    await createPostedInvoice({ business, client, userId, amount: 2000, issueDate: new Date(Date.now() - 50 * 86400000), dueDate: new Date(Date.now() - 20 * 86400000) });
    await createPostedInvoice({ business, client, userId, amount: 1000 });
    await ClientContract.create({ business, client: client._id, contractNumber: "CTR-T1", startDate: new Date(), baseValue: 12000, billingCycle: "quarterly", status: "active" });
    await callController(createReceipt, { user, body: { client: String(client._id), amount: 500, method: "cash", cashbookAccountId: String(cashbook._id), whtIncomeTax: { amount: 100 }, allocations: [] } });

    const res = await callController(getClientSummary, { user, params: { id: String(client._id) } });
    const s = res.payload.data.summary;
    expect(s.balance).toBe(3000);
    expect(s.overdue).toBe(2000);
    expect(s.unappliedCredit).toBe(600);
    expect(s.netBalance).toBe(2400);
    expect(s.creditUsed).toBe(2400);
    expect(s.creditUsedPercent).toBe(80);
    expect(s.mrr).toBe(4000); // 12,000 a quarter
    expect(s.lastPayment.amount).toBe(500);
    expect(s.openWhtCertificates).toEqual({ count: 1, incomeTax: 100, vat: 0 });

    // Credit hold blocks regardless of headroom; over-limit warns by default.
    expect((await assertClientCreditOk(client._id, { business, additionalAmount: 1000 })).level).toBe("warn");
    await Client.updateOne({ _id: client._id }, { $set: { creditHold: true, creditHoldReason: "Disputed account" } });
    const blocked = await assertClientCreditOk(client._id, { business });
    expect(blocked).toMatchObject({ ok: false, level: "block" });
  });
});
