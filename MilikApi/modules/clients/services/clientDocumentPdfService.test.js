// Smoke test: client invoice / credit note / contract / quote PDFs render (real headless Chromium).
// Launches Chromium (slow): run with RUN_PDF_TESTS=1
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import CompanySettings from "../../../models/CompanySettings.js";
import Client from "../models/Client.js";
import { createInvoice, postInvoice } from "../controllers/invoicesController.js";
import { createCreditNote } from "../controllers/creditNotesController.js";
import { createContract } from "../controllers/contractsController.js";
import { createQuote } from "../controllers/quotesController.js";
import { generateClientInvoicePdf } from "./clientInvoicePdfService.js";
import { generateClientNotePdf, generateContractPdf, generateQuotePdf } from "./clientDocumentPdfService.js";
import * as browser from "../../../services/browserService.js";

afterAll(async () => { if (process.env.RUN_PDF_TESTS) await browser.closeBrowser?.(); });

describe.skipIf(!process.env.RUN_PDF_TESTS)("client document PDFs", () => {
  it("renders invoice, credit note, contract and quote", async () => {
    const company = await createTestCompany({ modules: { clients: true } });
    await createTestChartOfAccounts(company._id);
    await CompanySettings.create({ company: company._id, clientBilling: { mpesaPaybill: "123456", bankDetails: { bankName: "KCB", accountNumber: "0011223344", accountName: "Test Co" } } });
    const user = { _id: (await createTestUser({ company })).id, company: String(company._id), adminAccess: true };
    const client = await Client.create({ business: company._id, name: "Acme", clientCode: "CLT-00001", taxPin: "P051234567X" });
    const lines = [{ itemName: "Support", description: "Support", quantity: 1, unitPrice: 1000, taxCodeKey: "vat_standard", billingFrequency: "monthly" }];

    const inv = await callController(createInvoice, { user, body: { client: String(client._id), dueDate: "2026-12-01", lineItems: lines } });
    await callController(postInvoice, { user, params: { id: inv.payload.invoice._id } });
    const note = await callController(createCreditNote, { user, params: { id: inv.payload.invoice._id }, body: { reason: "Goodwill", lines: [{ invoiceLineIndex: 0, amount: 100 }] } });
    const contract = await callController(createContract, { user, body: { client: String(client._id), startDate: "2026-01-01", endDate: "2026-12-31", lines } });
    const quote = await callController(createQuote, { user, body: { client: String(client._id), validUntil: "2099-01-01", lines } });

    const pdfs = {
      invoice: await generateClientInvoicePdf(inv.payload.invoice._id, company._id),
      note: await generateClientNotePdf(note.payload.note._id, company._id),
      contract: await generateContractPdf(contract.payload.contract._id, company._id),
      quote: await generateQuotePdf(quote.payload.quote._id, company._id),
    };
    for (const [name, buf] of Object.entries(pdfs)) {
      expect(buf.subarray(0, 4).toString()).toBe("%PDF");
      if (process.env.PDF_DUMP_DIR) fs.writeFileSync(`${process.env.PDF_DUMP_DIR}/client-${name}.pdf`, buf);
    }
  }, 180000);
});
