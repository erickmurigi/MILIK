// Smoke test: the customer invoice and receipt PDFs render (real headless Chromium) from the shared print engine.
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import { createTestInvoice, createTestReceipt } from "../test/factories.landlord.js";
import { generateInvoicePdf } from "./invoicePdfService.js";
import { generateReceiptPdf } from "./receiptPdfService.js";
import * as browser from "./browserService.js";
const closeBrowser = browser.closeBrowser;

afterAll(async () => { if (process.env.RUN_PDF_TESTS) await closeBrowser?.(); });

// Launches Chromium (slow): run with RUN_PDF_TESTS=1
describe.skipIf(!process.env.RUN_PDF_TESTS)("customer PDFs", () => {
  it("renders an invoice and a receipt", async () => {
    const bundle = await createTestInvoice({});
    const inv = await generateInvoicePdf(bundle.invoice._id, bundle.company._id);
    expect(inv.subarray(0, 4).toString()).toBe("%PDF");
    const { receipt } = await createTestReceipt({ invoiceBundle: bundle });
    const rec = await generateReceiptPdf(receipt._id, bundle.company._id);
    expect(rec.subarray(0, 4).toString()).toBe("%PDF");
    if (process.env.PDF_DUMP_DIR) {
      fs.writeFileSync(`${process.env.PDF_DUMP_DIR}/invoice.pdf`, inv);
      fs.writeFileSync(`${process.env.PDF_DUMP_DIR}/receipt.pdf`, rec);
    }
  }, 120000);
});
