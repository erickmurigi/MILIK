// Reports Center PDFs: the data builders return the shape listPageHtml expects, the row-count
// safety cap trips before an unbounded fetch, and the controller resolves a report id (404 for an
// unknown one). The real Puppeteer render is a separate smoke test gated by RUN_PDF_TESTS, matching
// the existing convention in services/customerPdfs.test.js.
import { describe, it, expect, afterAll } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import SaleProject from "../models/SaleProject.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import { SALE_REPORTS, assertWithinCap, MAX_REPORT_ROWS } from "../services/saleReportPdfData.js";
import { generateReportPdf } from "./salePdfReportsController.js";
import * as browser from "../../../services/browserService.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  const user = await createTestUser({ company });
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  return { company, business: company._id, call, user };
};

describe("sale report row-count cap", () => {
  it("passes under the limit and throws a clear 400 over it", () => {
    expect(() => assertWithinCap(MAX_REPORT_ROWS, "Test Report")).not.toThrow();
    let caught;
    try {
      assertWithinCap(MAX_REPORT_ROWS + 1, "Test Report");
    } catch (err) {
      caught = err;
    }
    expect(caught?.status).toBe(400);
    expect(caught?.message).toMatch(/narrow/i);
  });
});

describe("sale report PDF data builders", () => {
  it("return the listPageHtml shape even with no data", async () => {
    const { business } = await setup();
    const req = { query: {}, params: {} };
    for (const id of Object.keys(SALE_REPORTS)) {
      const spec = await SALE_REPORTS[id].build(business, req);
      expect(Array.isArray(spec.columns)).toBe(true);
      expect(spec.columns.length).toBeGreaterThan(0);
      expect(typeof spec.columns[0].value).toBe("function");
      expect(spec.rows).toEqual([]);
    }
  });

  it("sales register reflects a seeded deal and its payments", async () => {
    const { business } = await setup();
    const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Kitengela Plots" });
    const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent" });
    const buyer = await SaleBuyer.create({ business, buyerNumber: "B-1", fullName: "Buyer One", phone: "0700001" });
    const listing = await SaleListing.create({ business, listingNumber: "L-1", title: "Plot 1", unitNumber: "1", askingPrice: 1_050_000, project: project._id });
    const deal = await SaleDeal.create({ business, dealNumber: "D-1", listing: listing._id, buyer: buyer._id, agent: agent._id, agreedPrice: 1_000_000, status: "active" });
    await SalePayment.create({ business, paymentNumber: "P-1", deal: deal._id, amount: 400_000, status: "paid" });

    const spec = await SALE_REPORTS.register.build(business, { query: {}, params: {} });
    expect(spec.rows).toHaveLength(1);
    const col = (label) => spec.columns.find((c) => c.label === label).value(spec.rows[0]);
    expect(col("Deal")).toBe("D-1");
    expect(col("Buyer")).toBe("Buyer One");
    expect(col("Paid")).toContain("400,000.00");
    expect(col("Balance")).toContain("600,000.00");
  });

});

describe("generateReportPdf controller", () => {
  const fakeRes = () => {
    const res = { headers: null, body: null };
    res.set = (h) => { res.headers = h; return res; };
    res.send = (b) => { res.body = b; return res; };
    return res;
  };

  it("rejects an unknown report id with 404", async () => {
    const { user } = await setup();
    const req = { params: { reportId: "does-not-exist" }, query: {}, user };
    const res = fakeRes();
    let error;
    await generateReportPdf(req, res, (err) => { error = err; });
    expect(error?.status ?? error?.statusCode).toBe(404);
  });

  // Launches real headless Chromium (slow): run with RUN_PDF_TESTS=1
  describe.skipIf(!process.env.RUN_PDF_TESTS)("renders a real PDF", () => {
    afterAll(async () => { await browser.closeBrowser?.(); });

    it("for the receivables report, with the right headers", async () => {
      const { user } = await setup();
      const req = { params: { reportId: "receivables" }, query: {}, user };
      const res = fakeRes();
      let error;
      await generateReportPdf(req, res, (err) => { error = err; });
      expect(error).toBeUndefined();
      expect(res.headers["Content-Type"]).toBe("application/pdf");
      expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
    }, 120000);
  });
});
