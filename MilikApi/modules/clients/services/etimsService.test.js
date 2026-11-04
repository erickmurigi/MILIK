// eTIMS: payload builder, disabled no-op, idempotent submit and retry with a
// fake provider. Never calls KRA.
import { describe, it, expect } from "vitest";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientEtimsSettings from "../models/ClientEtimsSettings.js";
import EtimsSubmission from "../models/EtimsSubmission.js";
import { buildEtimsSalesPayload, buildEtimsQrUrl, etimsDate } from "./etimsOscuProvider.js";
import { submitInvoice, processEtimsRetries, updateEtimsSettings, getEtimsSettings, backoffMinutes } from "./etimsService.js";
import { setupClientsCompany, createPostedInvoice } from "../test/clientsTestKit.js";

const fakeProvider = ({ fail = false } = {}) => {
  const calls = [];
  return {
    calls,
    saveSales: async (payload) => {
      calls.push(payload);
      if (fail) throw Object.assign(new Error("eTIMS 910: Request parameter error"), { resultCd: "910", response: { resultCd: "910", resultMsg: "Request parameter error" } });
      return { resultCd: "000", resultMsg: "It is succeeded", data: { rcptNo: 41, intrlData: "INTRL123", rcptSign: "SIGNABC", sdcId: "KRACU0100000001" } };
    },
  };
};

const enable = (business) =>
  ClientEtimsSettings.create({ business, enabled: true, environment: "sandbox", kraPin: "P051234567X", branchId: "00", deviceSerial: "DVC-1", defaultItemClassCode: "81111500", defaultItemCode: "KE2NTU0000001" });

describe("eTIMS", () => {
  it("builds a tax-inclusive OSCU sales payload split by tax category", () => {
    const payload = buildEtimsSalesPayload({
      document: {
        issueDate: new Date("2026-11-03T08:00:00Z"),
        vatRate: 16,
        lineItems: [
          { description: "Consulting", quantity: 10, unitPrice: 1000, amount: 10000, taxable: true },
          { description: "Disbursement", quantity: 1, unitPrice: 500, amount: 500, taxable: false },
        ],
      },
      client: { name: "Acme Ltd", taxPin: "P051111111A", phone: "0712345678" },
      settings: { kraPin: "P051234567X", branchId: "00", defaultItemClassCode: "81111500" },
      invcNo: 7,
      companyName: "Milik Consulting",
    });
    expect(payload).toMatchObject({ tin: "P051234567X", bhfId: "00", invcNo: 7, orgInvcNo: 0, custTin: "P051111111A", rcptTyCd: "S", salesTyCd: "N", pmtTyCd: "02", salesDt: "20261103", totItemCnt: 2 });
    expect(payload.taxblAmtB).toBe(11600);
    expect(payload.taxAmtB).toBe(1600);
    expect(payload.taxRtB).toBe(16);
    expect(payload.taxblAmtA).toBe(500);
    expect(payload.totTaxblAmt).toBe(12100);
    expect(payload.totTaxAmt).toBe(1600);
    expect(payload.totAmt).toBe(12100);
    expect(payload.itemList[0]).toMatchObject({ itemSeq: 1, taxTyCd: "B", qty: 10, prc: 1160, splyAmt: 11600, taxblAmt: 11600, taxAmt: 1600, itemClsCd: "81111500" });
    expect(payload.itemList[1].taxTyCd).toBe("A");
    expect(etimsDate(new Date("2026-11-03T22:30:00Z"))).toBe("20261104"); // EAT is UTC+3
    expect(buildEtimsQrUrl({ environment: "production", kraPin: "P051234567X", branchId: "00", receiptSignature: "SIG" }))
      .toBe("https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=P051234567X00SIG");
  });

  it("is a no-op returning {skipped:true} while disabled", async () => {
    const { business, userId, client } = await setupClientsCompany();
    const invoice = await createPostedInvoice({ business, client, userId, amount: 100 });
    const provider = fakeProvider();
    expect(await submitInvoice({ business, invoiceId: invoice._id, provider })).toMatchObject({ skipped: true });
    await ClientEtimsSettings.create({ business, enabled: false });
    expect(await submitInvoice({ business, invoiceId: invoice._id, provider })).toMatchObject({ skipped: true });
    expect(provider.calls).toHaveLength(0);
    expect(await EtimsSubmission.countDocuments({ business })).toBe(0);
  });

  it("submits once, stamps the invoice with the CU number/QR, and resubmission is idempotent", async () => {
    const { business, userId, client } = await setupClientsCompany();
    await enable(business);
    const invoice = await createPostedInvoice({ business, client, userId, amount: 1000, vatRate: 16 });
    const provider = fakeProvider();

    const first = await submitInvoice({ business, invoiceId: invoice._id, provider });
    expect(first.submitted).toBe(true);
    expect(first.submission.cuInvoiceNumber).toBe("KRACU0100000001/41");
    const stamped = await ClientInvoice.findById(invoice._id).lean();
    expect(stamped.etimsCuInvoiceNumber).toBe("KRACU0100000001/41");
    expect(stamped.etimsStatus).toBe("submitted");
    expect(stamped.etimsQrUrl).toContain("P051234567X00SIGNABC");

    const again = await submitInvoice({ business, invoiceId: invoice._id, provider, force: true });
    expect(again.alreadySubmitted).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it("records failures with backoff and the retry job reuses the same eTIMS invoice number", async () => {
    const { business, userId, client } = await setupClientsCompany();
    await enable(business);
    const invoice = await createPostedInvoice({ business, client, userId, amount: 500 });

    const failing = fakeProvider({ fail: true });
    const failed = await submitInvoice({ business, invoiceId: invoice._id, provider: failing });
    expect(failed.submitted).toBe(false);
    expect(failed.submission.status).toBe("failed");
    expect(failed.submission.resultCode).toBe("910");
    expect(failed.submission.nextRetryAt).toBeTruthy();
    expect((await ClientInvoice.findById(invoice._id).lean()).etimsStatus).toBe("failed");
    expect(backoffMinutes(1)).toBe(1);
    expect(backoffMinutes(20)).toBe(360);

    const working = fakeProvider();
    const retry = await processEtimsRetries({ now: new Date(Date.now() + 10 * 60000), provider: working });
    expect(retry).toMatchObject({ checked: 1, submitted: 1 });
    expect(working.calls[0].invcNo).toBe(failing.calls[0].invcNo);
    expect((await EtimsSubmission.findOne({ documentId: invoice._id }).lean()).attempts).toBe(2);
  });

  it("stores the device key encrypted and never returns it", async () => {
    const { business } = await setupClientsCompany();
    await updateEtimsSettings({ business, input: { kraPin: "P051234567X", deviceSerial: "DVC-9", cmcKey: "super-secret-key" } });
    const raw = await ClientEtimsSettings.findOne({ business }).lean();
    expect(raw.cmcKeyEncrypted.startsWith("enc:")).toBe(true);
    expect(raw.cmcKeyEncrypted).not.toContain("super-secret-key");
    const shown = await getEtimsSettings(business);
    expect(shown.cmcKeyConfigured).toBe(true);
    expect(shown.cmcKeyEncrypted).toBeUndefined();
    await expect(updateEtimsSettings({ business, input: { enabled: true, deviceSerial: "" } })).rejects.toMatchObject({ status: 400 });
  });
});
