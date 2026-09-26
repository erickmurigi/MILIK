// The Car Wash dashboard's queue: every stage of a wash is counted, "open" means still being worked on, and payment is reported
// separately from the stage a job is at (a job can be paid while it is still drying).
import { describe, it, expect } from "vitest";
import CarWashJob from "../models/CarWashJob.js";
import { dailySummary, weeklySummary } from "./reportsController.js";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { carwash: true } });
  const user = await createTestUser({ company });
  const job = (status, paymentStatus = "unpaid") => CarWashJob.create({
    business: company._id, jobNumber: `CW-T-${++seq}`, plateNumber: `KAA${seq}A`, price: 300, status, paymentStatus,
    serviceLines: [{ serviceName: "Normal wash", price: 300 }],
  });
  return { company, user, job };
};

describe("car wash daily summary", () => {
  it("counts every stage, treats waiting/washing/drying/ready as open, and splits payment status", async () => {
    const { user, job } = await setup();
    await Promise.all([
      job("waiting"), job("washing"), job("washing", "paid"),
      job("drying", "paid"), job("drying"), job("drying", "partial"),
      job("ready", "paid"), job("ready"),
      job("done", "paid"), job("done", "paid"),
      job("cancelled"),
    ]);

    const res = await callController(dailySummary, { user, query: {} });
    const data = res.payload.data;
    expect(data.statusCounts).toMatchObject({ waiting: 1, washing: 2, drying: 3, ready: 2, done: 2, cancelled: 1 });
    expect(data.jobsCount).toBe(11);
    expect(data.openJobs).toBe(8); // 1 + 2 + 3 + 2: drying and ready are still in the shop, done and cancelled are finished
    // payment split leaves cancelled jobs out
    expect(data.paymentStatusCounts).toEqual({ paid: 5, partial: 1, unpaid: 4 });
  });

  it("gives the weekly summary the same figures", async () => {
    const { user, job } = await setup();
    await Promise.all([job("drying"), job("done", "paid"), job("cancelled")]);
    const res = await callController(weeklySummary, { user, query: {} });
    expect(res.payload.data.openJobs).toBe(1);
    expect(res.payload.data.paymentStatusCounts).toEqual({ paid: 1, partial: 0, unpaid: 1 });
  });
});
