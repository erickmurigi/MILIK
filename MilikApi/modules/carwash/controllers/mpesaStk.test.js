// An STK push is only "sent" when it is accepted; the money arrives later on Safaricom's callback. Once the callback says the customer
// paid, the job must show as paid, and the notification list must find a payment by plate, name, phone or receipt code.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashMpesaNotification from "../models/CarWashMpesaNotification.js";
import { handleStkCallback, listMpesaNotifications } from "./mpesaCallbackController.js";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { carwash: true } });
  const cashbook = await ChartOfAccount.create({
    business: company._id, code: "1099", name: "M-Pesa Cashbook", type: "asset", group: "assets", subGroup: "Cashbooks", isPosting: true,
  });
  await Company.updateOne({ _id: company._id }, {
    $set: { "paymentIntegration.mpesaPaybills": [{ name: "Main", enabled: true, isActive: true, shortCode: "174379", defaultCashbookAccountId: cashbook._id }] },
  });
  const job = await CarWashJob.create({
    business: company._id, jobNumber: "CW-TEST-0001", plateNumber: "KCA123A", price: 500, status: "waiting",
    serviceLines: [{ serviceName: "Full wash", price: 500 }],
  });
  return { company, job };
};

const stkSuccess = (checkoutId, amount) => ({
  Body: { stkCallback: {
    CheckoutRequestID: checkoutId, ResultCode: 0, ResultDesc: "ok",
    CallbackMetadata: { Item: [
      { Name: "Amount", Value: amount },
      { Name: "MpesaReceiptNumber", Value: "SIK7X2ABCD" },
      { Name: "TransactionDate", Value: 20260925101500 },
    ] },
  } },
});

describe("STK push callback", () => {
  it("records the payment AND marks the job paid when the customer completes the prompt", async () => {
    const { company, job } = await setup();
    await CarWashMpesaNotification.create({
      business: company._id, shortCode: "174379", transactionCode: "ws_CO_TEST_0001", plate: "KCA123A", amount: 500,
      matchedJob: job._id, status: "stk_pending", resultDesc: "STK push initiated",
    });
    const res = { status() { return this; }, json() { return this; } };
    await handleStkCallback({ params: { businessId: String(company._id) }, body: stkSuccess("ws_CO_TEST_0001", 500) }, res);

    expect(await CarWashPayment.countDocuments({ job: job._id, method: "mpesa", reference: "SIK7X2ABCD" })).toBe(1);
    const after = await CarWashJob.findById(job._id).lean();
    expect(after.paymentStatus).toBe("paid");   // was left "unpaid" by a ReferenceError after the payment row was written
    const notif = await CarWashMpesaNotification.findOne({ business: company._id }).lean();
    expect(notif.status).toBe("matched");
  });
});

describe("M-Pesa notification search", () => {
  it("finds a notification by receipt code, payer name, plate or phone", async () => {
    const company = await createTestCompany({ modules: { carwash: true } });
    const user = await createTestUser({ company });
    const n = await CarWashMpesaNotification.create({
      business: company._id, shortCode: "174379", transactionCode: "SIK7X2ABCD", plate: "KCA123A", billRefNumber: "kca 123a",
      amount: 300, senderName: "Grace Wanjiku", msisdn: "0712345678", status: "unmatched",
    });
    await CarWashMpesaNotification.create({ business: company._id, transactionCode: "OTHER00001", plate: "KZZ999Z", amount: 100, senderName: "Someone Else", msisdn: "0799999999", status: "unmatched" });
    const find = async (search) => {
      const { payload } = await callController(listMpesaNotifications, { user, query: { search } });
      return (payload.data?.notifications || []).map((x) => String(x._id));
    };
    for (const term of ["SIK7X2", "wanjiku", "kca123", "KCA 123A", "0712345", "712345678"]) {
      expect(await find(term), `search: ${term}`).toEqual([String(n._id)]);
    }
    expect(await find("(no such")).toEqual([]);
    expect(mongoose.connection.readyState).toBe(1);
  });
});
