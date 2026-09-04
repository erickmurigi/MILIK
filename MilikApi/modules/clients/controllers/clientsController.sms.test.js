// Regression test for the ad-hoc client SMS endpoint (sendClientSms), which
// reuses the shared communicationService.sendAdHocSms helper — the same
// one-off-send pattern already used by Property Sale's buyers/deals/leads
// controllers — rather than a bespoke SMS integration for this module.
//
// The test company has no SMS provider profile configured, so
// sendAdHocSms resolves to `null` (its own documented, non-throwing
// behaviour when no profile is enabled) instead of making a real network
// call. That still exercises the full controller path: phone/body
// validation, the client.phone fallback, and the ClientInteraction audit
// record — it just lands with emailStatus "failed" since dispatch could
// not be confirmed, exactly like a real failed/unconfigured provider would.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import Client from "../models/Client.js";
import ClientInteraction from "../models/ClientInteraction.js";
import { sendClientSms } from "./clientsController.js";

describe("sendClientSms", () => {
  it("sends to an explicit phone number and logs a ClientInteraction", async () => {
    const company = await createTestCompany({ modules: { clients: true } });
    const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
    const client = await Client.create({ business: company._id, name: "SMS Test Co", clientCode: "CLT-SMS-1", phone: "0700000001" });

    const result = await callController(sendClientSms, {
      user,
      params: { id: String(client._id) },
      body: { phone: "0711222333", body: "Hello from Milik" },
    });

    expect(result.statusCode).toBe(200);
    expect(result.payload.success).toBe(true);
    expect(result.payload.interaction.type).toBe("sms");
    expect(result.payload.interaction.subject).toBe("SMS to 0711222333");

    const logged = await ClientInteraction.findOne({ client: client._id, type: "sms" }).lean();
    expect(logged).toBeTruthy();
    expect(logged.body).toBe("Hello from Milik");
  }, 30000);

  it("falls back to the client's own phone number when none is provided in the body", async () => {
    const company = await createTestCompany({ modules: { clients: true } });
    const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
    const client = await Client.create({ business: company._id, name: "SMS Fallback Co", clientCode: "CLT-SMS-2", phone: "0722333444" });

    const result = await callController(sendClientSms, {
      user,
      params: { id: String(client._id) },
      body: { body: "Reminder: invoice due" },
    });

    expect(result.statusCode).toBe(200);
    expect(result.payload.interaction.subject).toBe("SMS to 0722333444");
  }, 30000);

  it("rejects when there is no phone number available at all", async () => {
    const company = await createTestCompany({ modules: { clients: true } });
    const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
    const client = await Client.create({ business: company._id, name: "No Phone Co", clientCode: "CLT-SMS-3" });

    await expect(
      callController(sendClientSms, { user, params: { id: String(client._id) }, body: { body: "Hi" } })
    ).rejects.toMatchObject({ status: 400 });
  }, 30000);

  it("rejects when the message body is empty", async () => {
    const company = await createTestCompany({ modules: { clients: true } });
    const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
    const client = await Client.create({ business: company._id, name: "Empty Body Co", clientCode: "CLT-SMS-4", phone: "0733444555" });

    await expect(
      callController(sendClientSms, { user, params: { id: String(client._id) }, body: { body: "" } })
    ).rejects.toMatchObject({ status: 400 });
  }, 30000);

  it("404s for a client that does not exist / belongs to another business", async () => {
    const company = await createTestCompany({ modules: { clients: true } });
    const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };

    await expect(
      callController(sendClientSms, {
        user,
        params: { id: "64b8f1a2c1234567890abcd0" },
        body: { phone: "0700000000", body: "Hi" },
      })
    ).rejects.toMatchObject({ status: 404 });
  }, 30000);
});
