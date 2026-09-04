// Regression test for the SMS fallback on contract renewal reminders.
// Before this fix, processRenewalReminders() did `if (!client?.email) continue;`
// — a client with a phone number but no email on file received NO renewal
// reminder at all, silently, forever. Now it falls back to an ad-hoc SMS
// (via the shared communicationService, same as sendClientSms) whenever the
// email channel isn't available or doesn't succeed.
//
// A tiny local HTTP server stands in for a real "custom HTTP" SMS provider —
// consistent with this suite's preference for exercising the real send path
// over module-mocking (there is no vi.mock precedent anywhere in this repo).
import http from "http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCompany } from "../../../test/factories.js";
import Client from "../models/Client.js";
import ClientContract from "../models/ClientContract.js";
import { processRenewalReminders } from "./renewalReminderService.js";

let server;
let serverUrl;
let receivedRequests = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      receivedRequests.push(JSON.parse(raw || "{}"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messageId: "test-msg-1", status: "sent" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}/sms`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

describe("processRenewalReminders", () => {
  it("falls back to SMS and marks the reminder sent for a client with a phone but no email", async () => {
    receivedRequests = [];
    const company = await createTestCompany({
      communication: {
        smsProfiles: [
          { _id: "profile1", provider: "custom_http", callbackUrl: serverUrl, enabled: true, isDefault: true, senderId: "MILIK" },
        ],
        defaultSmsProfileId: "profile1",
      },
    });
    const client = await Client.create({
      business: company._id,
      name: "Phone Only Co",
      clientCode: "CLT-RR-1",
      phone: "0711222333",
      // deliberately no email
    });
    const contract = await ClientContract.create({
      business: company._id,
      client: client._id,
      contractNumber: "CTR-RR-1",
      startDate: new Date(),
      endDate: daysFromNow(30),
      baseValue: 50000,
      currency: "KES",
      status: "active",
    });

    const sent = await processRenewalReminders();

    expect(sent).toBe(1);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].to).toBe("0711222333");
    expect(String(receivedRequests[0].message)).toContain("CTR-RR-1");

    const updated = await ClientContract.findById(contract._id).lean();
    expect(updated.remindersSent.days30).toBeTruthy();
  }, 30000);

  it("does not send or mark anything, and does not throw, for a client with neither email nor phone", async () => {
    receivedRequests = [];
    const company = await createTestCompany(); // no communication profiles configured
    const client = await Client.create({
      business: company._id,
      name: "Unreachable Co",
      clientCode: "CLT-RR-2",
      // no email, no phone
    });
    const contract = await ClientContract.create({
      business: company._id,
      client: client._id,
      contractNumber: "CTR-RR-2",
      startDate: new Date(),
      endDate: daysFromNow(30),
      baseValue: 20000,
      currency: "KES",
      status: "active",
    });

    const sent = await processRenewalReminders();

    expect(receivedRequests.length).toBe(0);
    const updated = await ClientContract.findById(contract._id).lean();
    expect(updated.remindersSent.days30).toBeFalsy();
    expect(sent).toBe(0);
  }, 30000);
});
