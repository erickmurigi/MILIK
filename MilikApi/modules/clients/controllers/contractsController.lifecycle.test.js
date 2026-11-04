// Contract lifecycle: line metrics, approval rules (approver != creator), persisted billing schedule
// (proration, hold/skip/release, suspension, termination), amendments with version diffs, and the
// escalation run applying an uplift exactly once.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import CompanySettings from "../../../models/CompanySettings.js";
import Client from "../models/Client.js";
import ClientContract from "../models/ClientContract.js";
import ClientContractVersion from "../models/ClientContractVersion.js";
import ClientBillingSchedule from "../models/ClientBillingSchedule.js";
import ClientInvoice from "../models/ClientInvoice.js";
import {
  createContract,
  updateContract,
  submitContract,
  approveContract,
  rejectContract,
  activateContract,
  suspendContract,
  resumeContract,
  terminateContract,
  cancelContract,
  amendContract,
  listContractVersions,
  getContractSchedule,
  changeSchedulePeriod,
  runEscalations,
} from "./contractsController.js";

const setup = async (clientBilling = null) => {
  const company = await createTestCompany({ modules: { clients: true } });
  await createTestChartOfAccounts(company._id);
  if (clientBilling) await CompanySettings.create({ company: company._id, clientBilling });
  const creator = { _id: (await createTestUser({ company })).id, company: String(company._id), adminAccess: true };
  const approver = { _id: (await createTestUser({ company })).id, company: String(company._id), adminAccess: true };
  const client = await Client.create({ business: company._id, name: "Globex", clientCode: "CLT-00009" });
  return { company, creator, approver, client };
};

const contractBody = (client, overrides = {}) => ({
  client: String(client._id),
  description: "Managed services",
  startDate: "2026-01-10",
  endDate: "2026-12-31",
  billingDay: 1,
  prorationRule: "daily",
  escalationPercent: 0,
  lines: [
    { itemName: "Support retainer", quantity: 1, unitPrice: 31000, billingFrequency: "monthly", taxCodeKey: "vat_standard" },
    { itemName: "Onboarding", quantity: 1, unitPrice: 20000, billingFrequency: "one_off", taxCodeKey: "vat_standard" },
  ],
  ...overrides,
});

const rows = (contractId) => ClientBillingSchedule.find({ contract: contractId }).sort({ from: 1, lineKey: 1 }).lean();

describe("Contract lines and metrics", () => {
  it("stores lines with stable keys and derives MRR/ACV/TCV on save", async () => {
    const { creator, client } = await setup();
    const res = await callController(createContract, { user: creator, body: contractBody(client, { startDate: "2026-01-01", endDate: "2026-12-31" }) });
    const contract = res.payload.contract;
    expect(contract.status).toBe("draft");
    expect(contract.lines).toHaveLength(2);
    expect(contract.lines.every((l) => l.lineKey)).toBe(true);
    expect(contract.lines[0]).toMatchObject({ taxCodeKey: "vat_standard", taxRate: 16, taxType: "vat" });
    expect(contract.mrr).toBe(31000);
    expect(contract.tcv).toBe(31000 * 12 + 20000);
    expect(contract.acv).toBe(contract.tcv);
    expect(contract.currentValue).toBe(contract.tcv);
  }, 60000);
});

describe("Approval rules", () => {
  it("requires approval above the value threshold, and the creator cannot approve", async () => {
    const { creator, approver, client } = await setup({ approvalThreshold: 100000 });
    const { payload } = await callController(createContract, { user: creator, body: contractBody(client) });
    const id = payload.contract._id;

    await expect(callController(activateContract, { user: creator, params: { id } })).rejects.toMatchObject({ status: 400 });

    const submitted = await callController(submitContract, { user: creator, params: { id } });
    expect(submitted.payload.requiresApproval).toBe(true);
    expect(submitted.payload.contract.status).toBe("pending_approval");

    await expect(callController(approveContract, { user: creator, params: { id } })).rejects.toMatchObject({ status: 403 });

    await expect(callController(rejectContract, { user: approver, params: { id }, body: {} })).rejects.toMatchObject({ status: 400 });
    const rejected = await callController(rejectContract, { user: approver, params: { id }, body: { reason: "Price too low" } });
    expect(rejected.payload.contract).toMatchObject({ status: "draft", approvalStatus: "rejected", rejectionReason: "Price too low" });

    await callController(submitContract, { user: creator, params: { id } });
    const approved = await callController(approveContract, { user: approver, params: { id } });
    expect(approved.payload.contract).toMatchObject({ status: "active", approvalStatus: "approved" });
    expect(await ClientContractVersion.countDocuments({ contract: id })).toBe(1);
    expect(await ClientBillingSchedule.countDocuments({ contract: id })).toBeGreaterThan(0);
  }, 60000);

  it("flags a line discount above the limit; within limits a submit activates directly", async () => {
    const { creator, client } = await setup({ maxDiscountWithoutApproval: 10 });
    const discounted = await callController(createContract, {
      user: creator,
      body: contractBody(client, { lines: [{ itemName: "Support", quantity: 1, unitPrice: 1000, discountPercent: 25, billingFrequency: "monthly" }] }),
    });
    const res = await callController(submitContract, { user: creator, params: { id: discounted.payload.contract._id } });
    expect(res.payload.requiresApproval).toBe(true);
    expect(res.payload.approvalReasons[0]).toMatch(/discount 25%/);

    const plain = await callController(createContract, { user: creator, body: contractBody(client) });
    const ok = await callController(submitContract, { user: creator, params: { id: plain.payload.contract._id } });
    expect(ok.payload.requiresApproval).toBe(false);
    expect(ok.payload.contract.status).toBe("active");
  }, 60000);

  it("cancel is for drafts only", async () => {
    const { creator, client } = await setup();
    const a = await callController(createContract, { user: creator, body: contractBody(client) });
    const cancelled = await callController(cancelContract, { user: creator, params: { id: a.payload.contract._id }, body: { reason: "Duplicate" } });
    expect(cancelled.payload.contract.status).toBe("cancelled");

    const b = await callController(createContract, { user: creator, body: contractBody(client) });
    await callController(submitContract, { user: creator, params: { id: b.payload.contract._id } });
    await expect(callController(cancelContract, { user: creator, params: { id: b.payload.contract._id } })).rejects.toMatchObject({ status: 400 });
  }, 60000);
});

describe("Billing schedule", () => {
  it("generates prorated periods, supports hold/skip/release, suspension and termination", async () => {
    const { creator, client } = await setup();
    const created = await callController(createContract, { user: creator, body: contractBody(client) });
    const id = created.payload.contract._id;
    await callController(submitContract, { user: creator, params: { id } });

    let schedule = await rows(id);
    const monthly = schedule.filter((r) => r.billingFrequency === "monthly");
    const oneOff = schedule.filter((r) => r.billingFrequency === "one_off");
    expect(oneOff).toHaveLength(1);
    expect(monthly).toHaveLength(12); // 10-31 Jan stub + Feb..Dec
    expect(monthly[0].from.toISOString().slice(0, 10)).toBe("2026-01-10");
    expect(monthly[0].to.toISOString().slice(0, 10)).toBe("2026-01-31");
    expect(monthly[0].netAmount).toBe(22000); // 31,000 x 22/31
    expect(monthly[0].taxAmount).toBe(3520);
    expect(monthly[1].netAmount).toBe(31000);

    // Hold needs a reason; held -> released; skip.
    const feb = monthly[1];
    const marRow = monthly[2];
    await expect(callController(changeSchedulePeriod("hold"), { user: creator, params: { id, rowId: String(feb._id) }, body: {} })).rejects.toMatchObject({ status: 400 });
    const held = await callController(changeSchedulePeriod("hold"), { user: creator, params: { id, rowId: String(feb._id) }, body: { reason: "Disputed scope" } });
    expect(held.payload.row.status).toBe("held");
    const released = await callController(changeSchedulePeriod("release"), { user: creator, params: { id, rowId: String(feb._id) } });
    expect(released.payload.row.status).toBe("scheduled");
    const skipped = await callController(changeSchedulePeriod("skip"), { user: creator, params: { id, rowId: String(marRow._id) }, body: { reason: "Free month" } });
    expect(skipped.payload.row.status).toBe("skipped");

    // Suspension holds periods from the suspension date; resuming skips the ones it covered.
    await callController(suspendContract, { user: creator, params: { id }, body: { reason: "Non-payment", effectiveDate: "2026-05-01" } });
    schedule = await rows(id);
    const may = schedule.find((r) => r.from.toISOString().startsWith("2026-05-01"));
    expect(may).toMatchObject({ status: "held", holdSource: "suspension" });
    await callController(resumeContract, { user: creator, params: { id }, body: { effectiveDate: "2026-06-01" } });
    schedule = await rows(id);
    expect(schedule.find((r) => r.from.toISOString().startsWith("2026-05-01")).status).toBe("skipped");
    expect(schedule.find((r) => r.from.toISOString().startsWith("2026-06-01")).status).toBe("scheduled");

    // Termination mid-August: later periods cancelled, August prorated, early termination fee invoiced.
    const terminated = await callController(terminateContract, {
      user: creator,
      params: { id },
      body: { effectiveDate: "2026-08-16", reason: "Client exit", earlyTerminationFee: 50000 },
    });
    expect(terminated.payload.contract.status).toBe("terminated");
    schedule = await rows(id);
    const aug = schedule.find((r) => r.from.toISOString().startsWith("2026-08-01"));
    expect(aug.to.toISOString().slice(0, 10)).toBe("2026-08-15");
    expect(aug.netAmount).toBe(15000); // 31,000 x 15/31
    const later = schedule.filter((r) => r.from >= new Date("2026-09-01"));
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((r) => r.status === "cancelled")).toBe(true);

    const feeInvoice = await ClientInvoice.findById(terminated.payload.terminationInvoice._id).lean();
    expect(feeInvoice).toMatchObject({ status: "draft", subtotal: 50000, vatAmount: 8000 });

    const view = await callController(getContractSchedule, { user: creator, params: { id } });
    expect(view.payload.summary.cancelled.count).toBe(later.length);
  }, 90000);
});

describe("Amendments and escalation", () => {
  it("an amendment creates a new version with line diffs and re-prices only later periods", async () => {
    const { creator, client } = await setup();
    const created = await callController(createContract, { user: creator, body: contractBody(client, { startDate: "2026-01-01" }) });
    const id = created.payload.contract._id;
    await callController(submitContract, { user: creator, params: { id } });
    const [retainer, onboarding] = created.payload.contract.lines;

    // Commercial edits on a live contract must go through /amend.
    await expect(callController(updateContract, { user: creator, params: { id }, body: { endDate: "2027-06-30" } })).rejects.toMatchObject({ status: 400 });

    const amended = await callController(amendContract, {
      user: creator,
      params: { id },
      body: {
        effectiveDate: "2026-07-01",
        changeSummary: "Price review",
        lines: [
          { lineKey: retainer.lineKey, itemName: retainer.itemName, quantity: 1, unitPrice: 35000, billingFrequency: "monthly", taxCodeKey: "vat_standard" },
          { lineKey: onboarding.lineKey, itemName: onboarding.itemName, quantity: 1, unitPrice: 20000, billingFrequency: "one_off", taxCodeKey: "vat_standard" },
          { itemName: "Hosting", quantity: 1, unitPrice: 5000, billingFrequency: "monthly", startDate: "2026-07-01", taxCodeKey: "vat_standard" },
        ],
      },
    });
    expect(amended.payload.version.version).toBe(2);
    const diffs = amended.payload.version.lineDiffs;
    expect(diffs.find((d) => d.change === "modified").fields.find((f) => f.field === "unitPrice")).toMatchObject({ from: 31000, to: 35000 });
    expect(diffs.find((d) => d.change === "added").itemName).toBe("Hosting");

    const schedule = await rows(id);
    const price = (month) => schedule.find((r) => r.lineKey === retainer.lineKey && r.from.toISOString().startsWith(month)).unitPrice;
    expect(price("2026-06-01")).toBe(31000);
    expect(price("2026-07-01")).toBe(35000);
    expect(schedule.some((r) => r.itemName === "Hosting" && r.from.toISOString().startsWith("2026-06"))).toBe(false);

    const versions = await callController(listContractVersions, { user: creator, params: { id } });
    expect(versions.payload.versions.map((v) => [v.version, v.status])).toEqual([[2, "applied"], [1, "superseded"]]);
  }, 90000);

  it("the escalation run applies a due uplift once and advances the next date", async () => {
    const { creator, client } = await setup();
    const created = await callController(createContract, {
      user: creator,
      body: contractBody(client, { startDate: "2024-01-01", endDate: "2027-12-31", escalationPercent: 10, escalationPeriodYears: 2, lines: [{ itemName: "Retainer", quantity: 1, unitPrice: 10000, billingFrequency: "monthly" }] }),
    });
    const id = created.payload.contract._id;
    expect(new Date(created.payload.contract.nextEscalationDate).toISOString().slice(0, 10)).toBe("2026-01-01");
    await callController(submitContract, { user: creator, params: { id } });

    const first = await callController(runEscalations, { user: creator, body: { asOf: "2026-01-02" } });
    expect(first.payload.escalated).toBe(1);
    const second = await callController(runEscalations, { user: creator, body: { asOf: "2026-01-02" } });
    expect(second.payload.escalated).toBe(0);

    const contract = await ClientContract.findById(id).lean();
    expect(contract.lines[0].unitPrice).toBe(11000);
    expect(contract.version).toBe(2);
    expect(new Date(contract.nextEscalationDate).toISOString().slice(0, 10)).toBe("2028-01-01");
    const escalations = await ClientContractVersion.find({ contract: id, versionType: "escalation" }).lean();
    expect(escalations).toHaveLength(1);
    expect(escalations[0].sourceKey).toBe("escalation:2026-01-01");

    const schedule = await rows(id);
    expect(schedule.find((r) => r.from.toISOString().startsWith("2025-12-01")).unitPrice).toBe(10000);
    expect(schedule.find((r) => r.from.toISOString().startsWith("2026-01-01")).unitPrice).toBe(11000);
  }, 90000);

  it("queues the escalation for approval when the company requires it", async () => {
    const { creator, client } = await setup({ escalationRequiresApproval: true });
    const created = await callController(createContract, {
      user: creator,
      body: contractBody(client, { startDate: "2024-01-01", endDate: "2027-12-31", escalationPercent: 5, lines: [{ itemName: "Retainer", quantity: 1, unitPrice: 10000, billingFrequency: "monthly" }] }),
    });
    const id = created.payload.contract._id;
    await callController(submitContract, { user: creator, params: { id } });
    const res = await callController(runEscalations, { user: creator, body: { asOf: "2026-02-01" } });
    expect(res.payload.pendingApproval).toBe(1);
    const contract = await ClientContract.findById(id).lean();
    expect(contract.lines[0].unitPrice).toBe(10000);
    expect(await ClientContractVersion.countDocuments({ contract: id, status: "pending_approval" })).toBe(1);
  }, 90000);
});
