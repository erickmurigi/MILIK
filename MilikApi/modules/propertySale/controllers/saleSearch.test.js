// The sale lists find records by part of a name, phone, unit, location... (the old $text search only matched whole words).
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import SaleLead from "../models/SaleLead.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleAgent from "../models/SaleAgent.js";
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

  it("finds a deal when the words are split between the buyer and the listing, and keeps every other filter", async () => {
    const { business, call } = await setup();
    const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane" });
    const buyer = await SaleBuyer.create({ business, buyerNumber: "B-1", fullName: "Wanjiru Njeri", phone: "0722111222" });
    const other = await SaleBuyer.create({ business, buyerNumber: "B-2", fullName: "Wanjiru Kamau", phone: "0733222333" });
    const karen = await SaleListing.create({ business, listingNumber: "L-1", title: "Karen Villa", askingPrice: 10 });
    const ruiru = await SaleListing.create({ business, listingNumber: "L-2", title: "Ruiru Plot", askingPrice: 5 });
    await SaleDeal.create({ business, dealNumber: "DL-0001", listing: karen._id, buyer: buyer._id, agent: agent._id, agreedPrice: 10 });
    await SaleDeal.create({ business, dealNumber: "DL-0002", listing: ruiru._id, buyer: other._id, agreedPrice: 5, status: "closed" });

    const numbers = async (query) => (await call(listDeals, query)).payload.data.map((d) => d.dealNumber);
    expect(await numbers({ search: "karen wanjiru" })).toEqual(["DL-0001"]);
    expect(await numbers({ search: "wanjiru" })).toEqual(["DL-0002", "DL-0001"]);
    expect(await numbers({ search: "ruiru njeri" })).toEqual([]);
    expect(await numbers({ search: "  wanjiru   ruiru " })).toEqual(["DL-0002"]);
    expect(await numbers({ search: "0722 111 222" })).toEqual(["DL-0001"]);
    expect(await numbers({ search: "wanjiru", status: "closed" })).toEqual(["DL-0002"]);
    expect(await numbers({ search: "wanjiru", agentId: String(agent._id) })).toEqual(["DL-0001"]);
    expect(await numbers({ search: "   " })).toEqual(["DL-0002", "DL-0001"]);
  });

  it("treats regular-expression characters in the box as plain text, on every list", async () => {
    const { business, call } = await setup();
    await SaleLead.create({ business, leadNumber: "LDR-1", fullName: "Plain Name", phone: "0700000001" });
    await SaleLead.create({ business, leadNumber: "LDR-2", fullName: "Odd (Name) [x] a+b", phone: "0700000002" });
    await SaleListing.create({ business, listingNumber: "L-1", title: "Plot A", askingPrice: 1 });
    await SaleListing.create({ business, listingNumber: "L-2", title: "Plot (B) 50% $", askingPrice: 1 });
    const literal = new Set(["(", "[", "a+b", "$"]); // characters that really are in the seeded names
    for (const bad of ["(", "[", "\\", "a+b", "*", "?", "^", "$", "|", "{1}", "(?=x)", "x".repeat(300)]) {
      const totals = await Promise.all([listLeads, listListings, listDeals].map(async (fn) => (await call(fn, { search: bad })).payload.total));
      expect(totals.reduce((a, b) => a + b, 0) > 0, JSON.stringify(bad)).toBe(literal.has(bad));
    }
    expect((await call(listLeads, { search: "(name)" })).payload.data.map((l) => l.fullName)).toEqual(["Odd (Name) [x] a+b"]);
    expect((await call(listLeads, { search: "a+b" })).payload.data).toHaveLength(1);
    expect((await call(listListings, { search: "50% $" })).payload.data.map((l) => l.title)).toEqual(["Plot (B) 50% $"]);
  });

  it("keeps the agent, overdue and status filters when a search is added", async () => {
    const { business, call } = await setup();
    const a = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane" });
    const past = new Date(Date.now() - 86_400_000);
    await SaleLead.create({ business, leadNumber: "LDR-1", fullName: "Kamau One", assignedAgent: a._id, nextFollowUpDate: past });
    await SaleLead.create({ business, leadNumber: "LDR-2", fullName: "Kamau Two", nextFollowUpDate: past });
    await SaleLead.create({ business, leadNumber: "LDR-3", fullName: "Kamau Three" });
    const names = async (query) => (await call(listLeads, query)).payload.data.map((l) => l.fullName).sort();
    expect(await names({ search: "kamau", overdueOnly: "1" })).toEqual(["Kamau One", "Kamau Two"]);
    expect(await names({ search: "kamau", overdueOnly: "1", agent: String(a._id) })).toEqual(["Kamau One"]);
    expect(await names({ search: "three", overdueOnly: "1" })).toEqual([]);

    const l = await SaleListing.create({ business, listingNumber: "L-1", title: "Karen Plot", askingPrice: 1, assignedAgent: a._id });
    await SaleListing.create({ business, listingNumber: "L-2", title: "Karen House", askingPrice: 1 });
    const titles = async (query) => (await call(listListings, query)).payload.data.map((x) => x.title);
    expect(await titles({ search: "karen", agentId: String(a._id) })).toEqual(["Karen Plot"]);
    expect(l._id).toBeTruthy();
  });
});
