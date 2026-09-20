// Company terminology (renamable words): saving, clearing, and the Sales words.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestUser } from "../../test/factories.js";
import { updateTerminology } from "./companySettings.js";

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
    // company B's user cannot write company A's words
    await expect(callController(updateTerminology, { user: b.user, params: { businessId: String(a.company._id) }, body: { terminology: { saleListing: "Hacked" } } })).rejects.toThrow(/Not authorized/);
  });

  it("rejects a non-object body", async () => {
    const { save } = await setup();
    await expect(save([])).rejects.toThrow(/plain object/);
  });
});
