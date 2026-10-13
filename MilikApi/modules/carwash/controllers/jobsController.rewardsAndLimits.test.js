// Regression coverage for four fixes made together in one pass (all production financial logic):
//  1. Loyalty reward redemption is now atomic at job *creation* time instead of deferred to a
//     later "done"/"paid" transition — closes a sequential double-redemption gap where one
//     pending reward could back more than one free job.
//  2. A job can only ever carry one reward line (business rule: a reward is tied to one chosen
//     service, so "two free services in one job" was never a real case the UI could produce).
//  3. The dead `_allowZeroPrice` request-body bypass of the "total price must be > 0" check has
//     been removed entirely.
//  4. Monthly/credit accounts' `creditLimit` is now a hard block at job creation, not just an
//     informational "over limit" badge.
import { describe, it, expect } from "vitest";
import { createJob } from "./jobsController.js";
import CarWashCustomer from "../models/CarWashCustomer.js";
import CarWashLoyaltyProgram from "../models/CarWashLoyaltyProgram.js";
import CarWashLoyaltyCard from "../models/CarWashLoyaltyCard.js";
import CarWashCreditAccount from "../models/CarWashCreditAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";

let seq = 0;
const nextPlate = () => `KAA${String(++seq).padStart(3, "0")}A`;

const setup = async () => {
  const company = await createTestCompany({ modules: { carwash: true } });
  const user = await createTestUser({ company });
  return { company, user };
};

const makeCustomerWithCard = async (company, { plate, pendingRewards = 0 }) => {
  const customer = await CarWashCustomer.create({ business: company._id, name: "Reward Tester", plates: [plate] });
  const program = await CarWashLoyaltyProgram.create({ business: company._id, isActive: true, stampsRequired: 10 });
  await CarWashLoyaltyCard.create({ business: company._id, customer: customer._id, program: program._id, pendingRewards });
  return { customer, program };
};

const createJobCall = (user, body) => callController(createJob, { user, body });

describe("reward redemption is atomic at job creation", () => {
  it("a job with a reward line immediately consumes the pending reward", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    await makeCustomerWithCard(company, { plate, pendingRewards: 1 });

    const res = await createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      serviceLines: [{ serviceName: "Free wash", price: 0, isRewardLine: true }],
    });
    expect(res.statusCode).toBe(201);

    const customer = await CarWashCustomer.findOne({ business: company._id, plates: plate });
    const card = await CarWashLoyaltyCard.findOne({ business: company._id, customer: customer._id });
    expect(card.pendingRewards).toBe(0);
    expect(card.totalRewardsRedeemed).toBe(1);
  });

  it("a second reward job for the same plate is rejected once the pending reward is used up — even before the first job is marked done (the sequential gap this closes)", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    await makeCustomerWithCard(company, { plate, pendingRewards: 1 });

    const first = await createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      serviceLines: [{ serviceName: "Free wash", price: 0, isRewardLine: true }],
    });
    expect(first.statusCode).toBe(201);
    // First job is still "waiting" — not done, not paid — yet the reward must already be gone.

    await expect(createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      serviceLines: [{ serviceName: "Free wash", price: 0, isRewardLine: true }],
    })).rejects.toThrow(/does not have a pending loyalty reward/i);

    const jobCount = await CarWashJob.countDocuments({ business: company._id, plateNumber: plate });
    expect(jobCount).toBe(1); // second attempt never created a job
  });

  it("rejects a job with more than one reward line (one reward = one chosen free service)", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    await makeCustomerWithCard(company, { plate, pendingRewards: 2 });

    await expect(createJobCall(user, {
      jobType: "vehicle",
      plateNumber: plate,
      serviceLines: [
        { serviceName: "Free wash", price: 0, isRewardLine: true },
        { serviceName: "Free wax", price: 0, isRewardLine: true },
      ],
    })).rejects.toThrow(/only one loyalty reward/i);
  });
});

describe("the _allowZeroPrice bypass is gone", () => {
  it("still rejects a zero-price job even when _allowZeroPrice is set", async () => {
    const { user } = await setup();
    await expect(createJobCall(user, {
      jobType: "vehicle",
      plateNumber: nextPlate(),
      serviceLines: [{ serviceName: "Suspicious free wash", price: 0 }],
      _allowZeroPrice: true,
    })).rejects.toThrow(/total job price must be greater than zero/i);
  });
});

describe("credit account limit is now a hard block", () => {
  const makeMonthlyAccount = async (company, plate, creditLimit) => {
    const customer = await CarWashCustomer.create({ business: company._id, name: "Credit Co", plates: [plate] });
    return CarWashCreditAccount.create({
      business: company._id, accountNumber: `CWAC-T-${++seq}`, customer: customer._id,
      plates: [plate], accountType: "monthly", creditLimit,
    });
  };

  it("rejects a job that would push a monthly account over its credit limit", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const account = await makeMonthlyAccount(company, plate, 1000);

    const first = await createJobCall(user, {
      jobType: "vehicle", plateNumber: plate, creditAccount: String(account._id),
      serviceLines: [{ serviceName: "Full wash", price: 900 }],
    });
    expect(first.statusCode).toBe(201); // 900 of 1000 — within limit

    await expect(createJobCall(user, {
      jobType: "vehicle", plateNumber: plate, creditAccount: String(account._id),
      serviceLines: [{ serviceName: "Full wash", price: 200 }],
    })).rejects.toThrow(/over its credit limit/i); // 900 + 200 = 1100 > 1000
  });

  it("allows a job that stays within the credit limit", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const account = await makeMonthlyAccount(company, plate, 1000);

    const res = await createJobCall(user, {
      jobType: "vehicle", plateNumber: plate, creditAccount: String(account._id),
      serviceLines: [{ serviceName: "Full wash", price: 1000 }],
    });
    expect(res.statusCode).toBe(201);
  });

  it("a creditLimit of 0 means unlimited — no block regardless of balance", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const account = await makeMonthlyAccount(company, plate, 0);

    const res = await createJobCall(user, {
      jobType: "vehicle", plateNumber: plate, creditAccount: String(account._id),
      serviceLines: [{ serviceName: "Full wash", price: 50000 }],
    });
    expect(res.statusCode).toBe(201);
  });

  it("prepaid accounts are unaffected — no credit-limit concept, wallet handles it separately", async () => {
    const { company, user } = await setup();
    const plate = nextPlate();
    const customer = await CarWashCustomer.create({ business: company._id, name: "Prepaid Co", plates: [plate] });
    const account = await CarWashCreditAccount.create({
      business: company._id, accountNumber: `CWAC-T-${++seq}`, customer: customer._id,
      plates: [plate], accountType: "prepaid", creditLimit: 0, accountCredit: 100,
    });

    const res = await createJobCall(user, {
      jobType: "vehicle", plateNumber: plate, creditAccount: String(account._id),
      serviceLines: [{ serviceName: "Full wash", price: 5000 }],
    });
    expect(res.statusCode).toBe(201); // never blocked by a "limit" — just doesn't fully auto-deduct
  });
});
