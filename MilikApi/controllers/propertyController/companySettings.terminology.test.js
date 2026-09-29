// Company terminology (renamable words): saving, clearing, and the Sales words.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestUser } from "../../test/factories.js";
import { getCompanySettings, updateTerminology } from "./companySettings.js";

const setup = async () => {
  const company = await createTestCompany();
  const user = await createTestUser({ company });
  const save = (terminology) => callController(updateTerminology, { user, params: { businessId: String(company._id) }, body: { terminology } });
  return { company, user, save };
};

describe("updateTerminology", () => {
  it("saves property-management and sales words together", async () => {
    const { save } = await setup();
    const { payload } = await save({ tenant: "Customer", saleListing: "Vehicle", saleListings: "Vehicles", saleModule: "Vehicle Sales" });
    expect(payload.terminology).toEqual({ tenant: "Customer", saleListing: "Vehicle", saleListings: "Vehicles", saleModule: "Vehicle Sales" });
  });

  it("removes a word that is sent blank (how a preset returns words to their defaults) and leaves unsent words alone", async () => {
    const { save } = await setup();
    await save({ tenant: "Client", saleListing: "Vehicle", saleListings: "Vehicles", saleBuyer: "Customer", saleBuyers: "Customers" });

    // "Sales: Real estate" clears every sales word but is not allowed to touch the PMS word
    const cleared = await save({ saleListing: "", saleListings: "", saleBuyer: "", saleBuyers: "" });
    expect(cleared.payload.terminology).toEqual({ tenant: "Client" });

    // a word that is not in the request is never changed
    const other = await save({ saleAgent: "Salesperson" });
    expect(other.payload.terminology).toEqual({ tenant: "Client", saleAgent: "Salesperson" });
  });

  it("comes back on the next load: the settings a fresh page reads include the saved words (cache included)", async () => {
    const { company, user, save } = await setup();
    const load = () => callController(getCompanySettings, { user, params: { businessId: String(company._id) } });

    // the settings are read (and cached) BEFORE the words are saved...
    expect((await load()).payload.terminology ?? {}).toEqual({});
    await save({ saleListing: "Vehicle", saleListings: "Vehicles", saleModule: "Vehicle Sales" });

    // ...and the very next read must already contain them, as plain JSON that survives a round trip
    const after = (await load()).payload;
    expect(JSON.parse(JSON.stringify(after.terminology))).toEqual({ saleListing: "Vehicle", saleListings: "Vehicles", saleModule: "Vehicle Sales" });

    // clearing them (a preset returning words to defaults) is remembered too
    await save({ saleListing: "", saleListings: "", saleModule: "" });
    expect((await load()).payload.terminology ?? {}).toEqual({});
  });

  it("ignores unknown words and trims / caps the value", async () => {
    const { save } = await setup();
    const { payload } = await save({ notAWord: "x", saleDeal: `  ${"Z".repeat(60)}  ` });
    expect(payload.terminology).toEqual({ saleDeal: "Z".repeat(40) });
  });

  it("keeps one company's words private to that company", async () => {
    const a = await setup();
    const b = await setup();
    await a.save({ saleListing: "Vehicle" });
    const other = await b.save({ saleAgent: "Rep" });
    expect(other.payload.terminology).toEqual({ saleAgent: "Rep" });
    // company B's user asking (by path param) for company A's settings is not honoured — every write still lands on
    // the caller's own company, the same rule the rest of the app uses (utils/requestContext.js), never A's
    const crossCompany = await callController(updateTerminology, { user: b.user, params: { businessId: String(a.company._id) }, body: { terminology: { saleListing: "Hacked" } } });
    expect(crossCompany.payload.terminology).toEqual({ saleAgent: "Rep", saleListing: "Hacked" }); // B's own settings, not A's
    const aStillHasItsOwn = await callController(getCompanySettings, { user: a.user, params: { businessId: String(a.company._id) } });
    expect(aStillHasItsOwn.payload.terminology ?? {}).toEqual({ saleListing: "Vehicle" });
  });

  it("rejects a non-object body", async () => {
    const { save } = await setup();
    await expect(save([])).rejects.toThrow(/plain object/);
  });
});
