// The sale lists find records by part of a name, phone, unit, location... (the old $text search only matched whole words).
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import SaleLead from "../models/SaleLead.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleDeal from "../models/SaleDeal.js";
import { listLeads } from "./leadsController.js";
import { listListings } from "./listingsController.js";
import { listDeals } from "./dealsController.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true } });
  const user = await createTestUser({ company });
  const call = (fn, query = {}) => callController(fn, { user, query });
  return { business: company._id, call };
};

describe("sale list search", () => {
  it("finds leads by part of a name, an email, a lead number or a phone written another way", async () => {
    const { business, call } = await setup();
    await SaleLead.create({ business, leadNumber: "LDR-0001", fullName: "James Kamau", phone: "+254 712 345 678", email: "jk@example.com" });
    await SaleLead.create({ business, leadNumber: "LDR-0002", fullName: "Amina Otieno", phone: "0799000111" });

    const names = async (search) => (await call(listLeads, { search })).payload.data.map((l) => l.fullName);
    expect(await names("kam")).toEqual(["James Kamau"]);
    expect(await names("james kam")).toEqual(["James Kamau"]);
    expect(await names("EXAMPLE.com")).toEqual(["James Kamau"]);
    expect(await names("LDR-0002")).toEqual(["Amina Otieno"]);
    expect(await names("0712345678")).toEqual(["James Kamau"]);
    expect(await names("0799")).toEqual(["Amina Otieno"]);
    expect(await names("nobody")).toEqual([]);
    expect((await call(listLeads, { search: ".*" })).payload.total).toBe(0);
    expect((await call(listLeads, {})).payload.total).toBe(2);
  });

  it("finds listings by unit, location or type", async () => {
    const { business, call } = await setup();
    await SaleListing.create({ business, listingNumber: "L-1", title: "Corner plot", unitNumber: "A12", location: "Kitengela", propertyType: "plot", askingPrice: 1 });
    await SaleListing.create({ business, listingNumber: "L-2", title: "Maisonette", location: "Runda", propertyType: "house", askingPrice: 2 });

    const titles = async (search, extra = {}) => (await call(listListings, { search, ...extra })).payload.data.map((l) => l.title);
    expect(await titles("kitengex")).toEqual([]);
    expect(await titles("kiteng")).toEqual(["Corner plot"]);
    expect(await titles("a12")).toEqual(["Corner plot"]);
    expect(await titles("house")).toEqual(["Maisonette"]);
    expect(await titles("l-2")).toEqual(["Maisonette"]);
    expect(await titles("plot", { status: "sold" })).toEqual([]);
  });

  it("finds deals by number, buyer name or phone, and listing title or unit", async () => {
    const { business, call } = await setup();
    const buyerA = await SaleBuyer.create({ business, buyerNumber: "B-1", fullName: "Wanjiru Njeri", phone: "0722111222" });
    const buyerB = await SaleBuyer.create({ business, buyerNumber: "B-2", fullName: "Peter Mwangi", phone: "0733222333" });
    const lA = await SaleListing.create({ business, listingNumber: "L-1", title: "Karen Villa", unitNumber: "V7", askingPrice: 10 });
    const lB = await SaleListing.create({ business, listingNumber: "L-2", title: "Ruiru Plot", askingPrice: 5 });
    await SaleDeal.create({ business, dealNumber: "DL-0001", listing: lA._id, buyer: buyerA._id, agreedPrice: 10 });
    await SaleDeal.create({ business, dealNumber: "DL-0002", listing: lB._id, buyer: buyerB._id, agreedPrice: 5 });

    const numbers = async (search) => (await call(listDeals, { search })).payload.data.map((d) => d.dealNumber);
    expect(await numbers("DL-0002")).toEqual(["DL-0002"]);
    expect(await numbers("wanj")).toEqual(["DL-0001"]);
    expect(await numbers("0733222333")).toEqual(["DL-0002"]);
    expect(await numbers("karen")).toEqual(["DL-0001"]);
    expect(await numbers("v7")).toEqual(["DL-0001"]);
    expect(await numbers("zzz")).toEqual([]);
    expect((await call(listDeals, { status: "active" })).payload.total).toBe(2);
  });
});
