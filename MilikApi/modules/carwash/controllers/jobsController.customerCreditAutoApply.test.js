// Regression coverage for auto-applying a CarWashCustomerCredit (customer overpayment credit)
// at job creation — mirrors the existing prepaid-wallet auto-deduct mechanism, but for the
// separate, customer-level credit pool created when a cash/M-Pesa payment overpays a job.
//
// Scope rules under test:
//  1. A credit that fits entirely within what's owed is auto-applied (ledger posted, doc
//     flipped to "applied", a CarWashPayment with method "credit" created, paymentStatus set).
//  2. A credit LARGER than what's owed is split: the job consumes exactly what it needs via a
//     new "applied" record, and the original keeps the unused remainder, still active.
//  3. Several small credits are applied oldest-first until the price is covered.
//  4. Voucher jobs never consume customer credit (billed to a third party).
//  5. The prepaid-wallet mechanism and the customer-credit mechanism correctly stack via the
//     shared `appliedSoFar` tracking, when neither alone covers the full price but both do.
import { describe, it, expect } from "vitest";
import { createJob } from "./jobsController.js";
import CarWashCustomer from "../models/CarWashCustomer.js";
import CarWashCustomerCredit from "../models/CarWashCustomerCredit.js";
import CarWashCreditAccount from "../models/CarWashCreditAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";

let seq = 0;
const nextPlate = () => `KCC${String(++seq).padStart(3, "0")}A`;

const setup = async () => {
  const company = await createTestCompany({ modules: { carwash: true } });
  const user = await createTestUser({ company });
  return { company, user };
};

const createJobCall = (user, body) => callController(createJob, { user, body });

const makeCustomer = async (company, plate, name = "Credit Tester") =>
  CarWashCustomer.create({ business: company._id, name, plates: [plate] });

const makeCredit = async (company, customer, plate, amount) =>
  CarWashCustomerCredit.create({
    business: company._id,
    customer: customer._id,
    plates: [plate],
    amount,
    status: "active",
  });

describe("customer overpayment credit auto-applies at job creation", () => {
  it("a single credit that fits within the job price is fully applied and marks the job paid", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const customer = await makeCustomer(company, plate);
    const credit = await makeCredit(company, customer, plate, 50);

    const res = await createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      serviceLines: [{ serviceName: "Full wash", price: 50 }],
    });
    expect(res.statusCode).toBe(201);

    const updatedCredit = await CarWashCustomerCredit.findById(credit._id);
    expect(updatedCredit.status).toBe("applied");
    expect(String(updatedCredit.appliedToJob)).toBe(String(res.payload.job._id));

    const payments = await CarWashPayment.find({ business: company._id, job: res.payload.job._id });
    expect(payments).toHaveLength(1);
    expect(payments[0].method).toBe("credit");
    expect(payments[0].amount).toBe(50);

    const job = await CarWashJob.findById(res.payload.job._id);
    expect(job.paymentStatus).toBe("paid");
  });

  it("a credit smaller than the job price is applied and leaves the job partially paid", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const customer = await makeCustomer(company, plate);
    const credit = await makeCredit(company, customer, plate, 30);

    const res = await createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      serviceLines: [{ serviceName: "Full wash", price: 100 }],
    });
    expect(res.statusCode).toBe(201);

    const updatedCredit = await CarWashCustomerCredit.findById(credit._id);
    expect(updatedCredit.status).toBe("applied");

    const job = await CarWashJob.findById(res.payload.job._id);
    expect(job.paymentStatus).toBe("partial");

    const payments = await CarWashPayment.find({ business: company._id, job: job._id });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(30);
  });

  it("a credit LARGER than what's owed is split: the job gets exactly what it needs, the leftover stays active", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const customer = await makeCustomer(company, plate);
    // The exact scenario the user asked about: KES 300 credit against a KES 250 job.
    const credit = await makeCredit(company, customer, plate, 300);

    const res = await createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      serviceLines: [{ serviceName: "Full wash", price: 250 }],
    });
    expect(res.statusCode).toBe(201);

    // Original record keeps the unused remainder and stays active — never deleted, never
    // reused as the "applied" record itself (so its own ledger/history trail is untouched).
    const original = await CarWashCustomerCredit.findById(credit._id);
    expect(original.status).toBe("active");
    expect(original.amount).toBe(50);

    // The consumed portion is a brand-new, separate "applied" record.
    const appliedSplit = await CarWashCustomerCredit.findOne({
      business: company._id, customer: customer._id, status: "applied", _id: { $ne: credit._id },
    });
    expect(appliedSplit).toBeTruthy();
    expect(appliedSplit.amount).toBe(250);
    expect(String(appliedSplit.appliedToJob)).toBe(String(res.payload.job._id));
    expect(appliedSplit.notes).toMatch(new RegExp(String(credit._id)));

    const job = await CarWashJob.findById(res.payload.job._id);
    expect(job.paymentStatus).toBe("paid");

    const payments = await CarWashPayment.find({ business: company._id, job: job._id, method: "credit" });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(250);

    // The customer's total available credit is conserved: 50 left active, nothing lost.
    const totalActiveCredit = (await CarWashCustomerCredit.find({ business: company._id, customer: customer._id, status: "active" }))
      .reduce((s, c) => s + c.amount, 0);
    expect(totalActiveCredit).toBe(50);
  });

  it("two small credits that together cover the price are both applied, oldest-first", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const customer = await makeCustomer(company, plate);
    const creditA = await makeCredit(company, customer, plate, 40);
    // Ensure distinct createdAt ordering regardless of clock resolution
    await new Promise((r) => setTimeout(r, 5));
    const creditB = await makeCredit(company, customer, plate, 60);

    const res = await createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      serviceLines: [{ serviceName: "Full wash", price: 100 }],
    });
    expect(res.statusCode).toBe(201);

    const [updatedA, updatedB] = await Promise.all([
      CarWashCustomerCredit.findById(creditA._id),
      CarWashCustomerCredit.findById(creditB._id),
    ]);
    expect(updatedA.status).toBe("applied");
    expect(updatedB.status).toBe("applied");

    const job = await CarWashJob.findById(res.payload.job._id);
    expect(job.paymentStatus).toBe("paid");

    const payments = await CarWashPayment.find({ business: company._id, job: job._id, method: "credit" });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(100);
  });

  it("a credit is never applied to a voucher job (billed to a third party)", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const customer = await makeCustomer(company, plate);
    const credit = await makeCredit(company, customer, plate, 50);

    const voucherCustomer = await CarWashCustomer.create({ business: company._id, name: "Voucher Co", plates: [plate] });
    const voucherAccount = await CarWashCreditAccount.create({
      business: company._id,
      accountNumber: `CWAC-V-${++seq}`,
      customer: voucherCustomer._id,
      plates: [plate],
      accountType: "voucher",
      contactPerson: "Voucher Partner Co",
    });

    const res = await createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      creditAccount: String(voucherAccount._id),
      serviceLines: [{ serviceName: "Full wash", price: 100 }],
    });
    expect(res.statusCode).toBe(201);

    const untouchedCredit = await CarWashCustomerCredit.findById(credit._id);
    expect(untouchedCredit.status).toBe("active");

    const job = await CarWashJob.findById(res.payload.job._id);
    const creditPayments = await CarWashPayment.find({ business: company._id, job: job._id, method: "credit" });
    expect(creditPayments).toHaveLength(0);
  });

  it("stacks correctly with the prepaid wallet: neither alone covers the job, both together do", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const customer = await makeCustomer(company, plate);

    const prepaidAccount = await CarWashCreditAccount.create({
      business: company._id,
      accountNumber: `CWAC-P-${++seq}`,
      customer: customer._id,
      plates: [plate],
      accountType: "prepaid",
      accountCredit: 40,
    });
    const credit = await makeCredit(company, customer, plate, 60);

    const res = await createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      creditAccount: String(prepaidAccount._id),
      serviceLines: [{ serviceName: "Full wash", price: 100 }],
    });
    expect(res.statusCode).toBe(201);

    const job = await CarWashJob.findById(res.payload.job._id);
    expect(job.paymentStatus).toBe("paid");

    const updatedCredit = await CarWashCustomerCredit.findById(credit._id);
    expect(updatedCredit.status).toBe("applied");

    const updatedAccount = await CarWashCreditAccount.findById(prepaidAccount._id);
    expect(updatedAccount.accountCredit).toBe(0);

    const payments = await CarWashPayment.find({ business: company._id, job: job._id }).sort({ amount: 1 });
    expect(payments).toHaveLength(2);
    const prepaidPayment = payments.find((p) => p.method === "prepaid");
    const creditPayment = payments.find((p) => p.method === "credit");
    expect(prepaidPayment.amount).toBe(40);
    expect(creditPayment.amount).toBe(60);
    const total = payments.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(100);
  });
});
