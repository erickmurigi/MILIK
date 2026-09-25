// Contract between the mobile Property Sales screens (MilikMobile/app/(app)/sales/**) and the real controllers.
// Every request below is built the way the mobile code builds it (same param / body objects, field names, enum values
// and date formats; query values are strings because axios serialises them) and answered by the real controller.
// Each test then asserts the exact keys the .tsx reads, so a renamed server field or a wrong enum on either side fails here.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import SaleProject from "../models/SaleProject.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import SaleLead from "../models/SaleLead.js";
import SaleSettings from "../models/SaleSettings.js";
import SaleCommission from "../models/SaleCommission.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { attachAgentScope } from "../middleware/agentScope.js";
import { getDashboardStats } from "./reportsController.js";
import { getOverdueInstallments, getReceivables } from "./collectionsReportsController.js";
import { convertLead, createLead, getLead, getPipeline, listLeads, updateLead } from "./leadsController.js";
import { createActivity, listActivities } from "./activitiesController.js";
import { closeDeal, getDeal, listDeals } from "./dealsController.js";
import { createPayment, listPayments } from "./paymentsController.js";
import { listSchedule } from "./scheduleController.js";
import { listAgents } from "./agentsController.js";
import { getListing, listListings } from "./listingsController.js";
import { getSettings, loadDefaults } from "./settingsController.js";
import { getCompanySettings, updateTerminology } from "../../../controllers/propertyController/companySettings.js";
// The mobile helpers themselves, so a drift in the constants / date rule is caught here.
import {
  ACTIVITY_OUTCOMES, ACTIVITY_TYPES, DEFAULT_LEAD_STAGES, PAYMENT_METHODS, PAYMENT_TYPES,
  activityDate, dealBalance, nameToValue, pageOf, resolveTerms,
} from "../../../../MilikMobile/utils/sales.ts";
import { fmtDate, todayISO } from "../../../../MilikMobile/utils/pmsFormat.ts";
import { preferredCashbook, round2 } from "../../../../MilikMobile/utils/carwash.ts";

// ── how the mobile app sends things ─────────────────────────────────────────────────────────────
// axios: undefined / null params are dropped, everything is a string on the wire. usePmsList also drops ''.
const wire = (o = {}) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
);
// JSON body: undefined keys vanish, Dates become ISO strings.
const json = (o = {}) => JSON.parse(JSON.stringify(o));

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  const user = await createTestUser({ company });
  const business = company._id;

  // run a controller as `who` behind the real attachAgentScope middleware (what the sale routers do)
  const as = (who) => async (fn, { query = {}, body = {}, params = {} } = {}) => {
    const req = { user: who, query: wire(query), body: json(body), params, headers: {} };
    await attachAgentScope(req, {}, (err) => { if (err) throw err; });
    return callController(fn, { user: who, query: req.query, body: req.body, params, saleAgentId: req.saleAgentId, saleAgentSelf: req.saleAgentSelf });
  };
  const call = as(user);

  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Kitengela Plots" });
  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111" });

  const mkListing = (over = {}) => {
    const n = ++seq;
    return SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, ...over });
  };
  const mkBuyer = (over = {}) => {
    const n = ++seq;
    return SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com`, ...over });
  };
  // an active deal; listing is put "under_contract" like a real one
  const mkDeal = async ({ price = 1_000_000, agent: dealAgent = agent, status = "active", listingOver = {}, buyerOver = {} } = {}) => {
    const listing = await mkListing({ status: "under_contract", ...listingOver });
    const buyer = await mkBuyer(buyerOver);
    const n = ++seq;
    const deal = await SaleDeal.create({ business, dealNumber: `DL-${n}`, listing: listing._id, buyer: buyer._id, agent: dealAgent?._id ?? null, agreedPrice: price, status });
    return { deal, listing, buyer };
  };
  const mkLead = (over = {}) => {
    const n = ++seq;
    return SaleLead.create({ business, leadNumber: `LDR-${n}`, fullName: `Lead ${n}`, phone: `0722${n}`, ...over });
  };
  const mkCashbook = (over = {}) =>
    ChartOfAccount.create({ business, code: `13${++seq}`, name: "Equity Bank", type: "asset", group: "assets", subGroup: "Cashbooks", isPosting: true, ...over });

  return { company, user, business, call, as, project, agent, mkListing, mkBuyer, mkDeal, mkLead, mkCashbook };
};

// an agent-linked user (SaleAgent.userId) - the company default keeps such users to their own records
const agentUser = async (ctx, name = "Own Agent") => {
  const user = await createTestUser({ company: ctx.company });
  const agent = await SaleAgent.create({ business: ctx.business, agentNumber: `AG-${++seq}`, fullName: name, userId: user._id });
  return { user, agent, call: ctx.as(user) };
};

// ── Dashboard (sales/index.tsx) ─────────────────────────────────────────────────────────────────
describe("mobile contract: sales dashboard", () => {
  it("answers every nested key the dashboard reads, with numbers", async () => {
    const ctx = await setup();
    const { business, call, agent } = ctx;
    await ctx.mkListing({ status: "available", propertyType: "plot" });
    await ctx.mkListing({ status: "reserved" });
    const active = await ctx.mkDeal({ price: 500_000 });
    const closed = await ctx.mkDeal({ price: 300_000, status: "closed" });
    await SalePayment.create({ business, paymentNumber: "P-1", deal: active.deal._id, amount: 120_000, status: "paid" });
    await SaleCommission.create({ business, commissionNumber: "C-1", deal: closed.deal._id, agent: agent._id, saleAmount: 300_000, commissionRate: 3, commissionAmount: 9_000 });
    await ctx.mkLead({ status: "new" });
    await ctx.mkLead({ status: "converted" });
    await ctx.mkLead({ status: "contacted", nextFollowUpDate: new Date(Date.now() - 2 * 86_400_000) });

    const { statusCode, payload: d } = await call(getDashboardStats);
    expect(statusCode).toBe(200);
    for (const [group, keys] of Object.entries({
      listings: ["available", "reserved", "underContract", "sold", "total"],
      deals: ["active", "closed", "cancelled", "activeValue", "closedValue"],
      payments: ["totalCollected", "count"],
      commissions: ["pending", "approved", "paid"],
      leads: ["active", "overdue", "total", "converted"],
    })) {
      for (const k of keys) expect(typeof d[group][k], `${group}.${k}`).toBe("number");
    }
    expect(d.listings).toMatchObject({ available: 1, reserved: 1, underContract: 2 });
    expect(d.deals).toMatchObject({ active: 1, closed: 1, activeValue: 500_000, closedValue: 300_000 });
    expect(d.payments).toMatchObject({ totalCollected: 120_000, count: 1 });
    expect(d.commissions.pending).toBe(9_000);
    expect(d.leads).toMatchObject({ active: 2, overdue: 1, total: 3, converted: 1 });

    // recentDeals rows: exactly what the "Recent deals" list renders
    expect(d.recentDeals).toHaveLength(2);
    const row = d.recentDeals.find((r) => r.status === "active");
    expect(row).toMatchObject({ agreedPrice: 500_000, status: "active" });
    expect(row._id).toBeTruthy();
    expect(row.dealNumber).toMatch(/^DL-/);
    expect(row.listing.title).toMatch(/^Plot/);
    expect(row.listing.listingNumber).toMatch(/^L-/);
    expect(row.buyer.fullName).toMatch(/^Buyer/);
    // recentListings rows
    const rl = d.recentListings.find((r) => r.status === "available");
    expect(rl).toMatchObject({ propertyType: "plot", askingPrice: 1_000_000 });
    expect(rl._id && rl.listingNumber && rl.title).toBeTruthy();
  });

  it("receivables (limit 1) and overdue instalments (limit 5) carry the totals and rows the dashboard reads", async () => {
    const ctx = await setup();
    const { business, call } = ctx;
    const { deal } = await ctx.mkDeal({ price: 900_000, buyerOver: { fullName: "Anna Wanjiku" } });
    await SalePayment.create({ business, paymentNumber: "P-9", deal: deal._id, amount: 300_000, status: "paid" });
    for (let i = 1; i <= 7; i += 1) {
      await SalePaymentSchedule.create({ business, deal: deal._id, installmentNumber: i, dueDate: new Date(Date.now() - i * 10 * 86_400_000), expectedAmount: 100_000, status: "upcoming" });
    }

    const recv = (await call(getReceivables, { query: { limit: 1 } })).payload;
    expect(recv.totals).toMatchObject({ balance: 600_000, overdue: 700_000, deals: 1 });
    for (const k of ["balance", "overdue", "deals"]) expect(typeof recv.totals[k]).toBe("number");

    const od = (await call(getOverdueInstallments, { query: { limit: 5 } })).payload;
    expect(od.totals).toMatchObject({ count: 7, amount: 700_000 });
    expect(od.data).toHaveLength(5); // the dashboard shows 5 and "...and 2 more"
    const r = od.data[0];
    expect(String(r._id)).toBeTruthy();
    expect(String(r.dealId)).toBe(String(deal._id)); // the row links to /sales/deals/<dealId>
    expect(r.dealNumber).toBe(deal.dealNumber);
    expect(r.buyerName).toBe("Anna Wanjiku");
    expect(r.amount).toBe(100_000);
    expect(r.daysLate).toBeGreaterThanOrEqual(1);
    expect(new Date(r.dueDate).getTime()).toBeLessThan(Date.now());
  });

  it("the dashboard shortcuts open lists that accept their params (status tabs, overdue follow-ups)", async () => {
    const ctx = await setup();
    const { call } = ctx;
    await ctx.mkListing({ status: "available" });
    await ctx.mkListing({ status: "under_contract" });
    await ctx.mkLead({ status: "new", nextFollowUpDate: new Date(Date.now() - 86_400_000) });
    await ctx.mkLead({ status: "new" });
    await ctx.mkDeal({ status: "closed" });
    // /sales/listings?status=under_contract, /sales/deals?status=closed, /sales/leads?overdue=1 (-> overdueOnly=1)
    expect((await call(listListings, { query: { status: "under_contract", page: 1, limit: 30 } })).payload.data.every((l) => l.status === "under_contract")).toBe(true);
    expect((await call(listDeals, { query: { status: "closed", page: 1, limit: 30 } })).payload.total).toBe(1);
    expect((await call(listLeads, { query: { overdueOnly: "1", page: 1, limit: 30 } })).payload.total).toBe(1);
  });
});

// ── Leads (leads/index.tsx, leads/new.tsx, leads/[id].tsx) ───────────────────────────────────────
describe("mobile contract: leads", () => {
  it("list: the paged response the list screen and pageOf() read, with the agent populated", async () => {
    const ctx = await setup();
    const { call, agent } = ctx;
    for (let i = 0; i < 3; i += 1) await ctx.mkLead({ assignedAgent: agent._id, budgetMin: 1_000_000, budgetMax: 2_000_000, source: "referral" });
    const { statusCode, payload } = await call(listLeads, { query: { status: undefined, overdueOnly: undefined, search: undefined, page: 1, limit: 2 } });
    expect(statusCode).toBe(200);
    const page = pageOf(payload);
    expect(page.rows).toHaveLength(2);
    expect(page.pages).toBe(2);
    expect(page.total).toBe(3);
    const l = page.rows[0];
    for (const k of ["_id", "leadNumber", "fullName", "phone", "source", "status", "budgetMin", "budgetMax"]) expect(l[k], k).toBeDefined();
    expect(l.assignedAgent.fullName).toBe("Jane Agent");
    // page 2 has the remaining row and no overlap
    const p2 = pageOf((await call(listLeads, { query: { page: 2, limit: 2 } })).payload);
    expect(p2.rows).toHaveLength(1);
    expect(page.rows.map((r) => String(r._id))).not.toContain(String(p2.rows[0]._id));
  });

  it("search: the debounced, trimmed box text finds by name / phone / email / number, filters compose", async () => {
    const ctx = await setup();
    const { call } = ctx;
    await ctx.mkLead({ fullName: "James Kamau", phone: "+254 712 345 678", email: "jk@example.com", status: "qualified" });
    await ctx.mkLead({ fullName: "Amina Otieno", phone: "0799000111", status: "new" });
    const find = async (query) => (await call(listLeads, { query: { page: 1, limit: 30, ...query } })).payload.data.map((l) => l.fullName);
    expect(await find({ search: "kam" })).toEqual(["James Kamau"]);
    expect(await find({ search: "0712345678" })).toEqual(["James Kamau"]);
    expect(await find({ search: "otieno", status: "new" })).toEqual(["Amina Otieno"]);
    expect(await find({ search: "otieno", status: "qualified" })).toEqual([]);
  });

  it("pipeline: [{_id: status, count}] for the tab badges", async () => {
    const ctx = await setup();
    const { call } = ctx;
    await ctx.mkLead({ status: "new" });
    await ctx.mkLead({ status: "new" });
    await ctx.mkLead({ status: "lost" });
    const { payload } = await call(getPipeline);
    const counts = Object.fromEntries(payload.pipeline.map((p) => [p._id, p.count]));
    expect(counts).toEqual({ new: 2, lost: 1 });
  });

  it("create: the exact body new.tsx sends (first pipeline stage, chosen source, agent, follow-up date, budget)", async () => {
    const ctx = await setup();
    const { call, agent, business } = ctx;
    const { statusCode, payload } = await call(createLead, {
      body: {
        fullName: "Grace Njeri", phone: "0712 345 678", email: "grace@example.com",
        source: "referral", status: DEFAULT_LEAD_STAGES.find((s) => s !== "converted" && s !== "lost"),
        assignedAgent: String(agent._id), nextFollowUpDate: "2026-10-05",
        budgetMin: 1_500_000, budgetMax: 3_000_000, notes: "Wants a corner plot",
      },
    });
    expect(statusCode).toBe(201);
    expect(payload).toMatchObject({ fullName: "Grace Njeri", phone: "0712 345 678", source: "referral", status: "new", budgetMin: 1_500_000, budgetMax: 3_000_000, notes: "Wants a corner plot" });
    expect(payload.leadNumber).toMatch(/^LDR/);
    expect(String(payload.assignedAgent)).toBe(String(agent._id));
    expect(new Date(payload.nextFollowUpDate).toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(await SaleLead.countDocuments({ business })).toBe(1);
  });

  it("create: the agent picker on the form (limit 200, active only) lists agents with _id and fullName", async () => {
    const ctx = await setup();
    await SaleAgent.create({ business: ctx.business, agentNumber: "AG-9", fullName: "Retired Agent", status: "inactive" });
    const { payload } = await ctx.call(listAgents, { query: { limit: 200, status: "active" } });
    expect(payload.data.map((a) => a.fullName)).toEqual(["Jane Agent"]);
    expect(String(payload.data[0]._id)).toBe(String(ctx.agent._id));
  });

  it("create: only a name (empty phone / email, no agent, no budget, no date) is accepted", async () => {
    const ctx = await setup();
    const { statusCode, payload } = await ctx.call(createLead, {
      body: { fullName: "Walk In", phone: "", email: "", source: "walk_in", status: "new", assignedAgent: undefined, nextFollowUpDate: undefined, budgetMin: undefined, budgetMax: undefined, notes: undefined },
    });
    expect(statusCode).toBe(201);
    expect(payload).toMatchObject({ fullName: "Walk In", budgetMin: 0, budgetMax: 0, assignedAgent: null, nextFollowUpDate: null });
  });

  it("create: every source / stage the settings screen can offer is accepted (nameToValue matches the server)", async () => {
    const ctx = await setup();
    const { call, business } = ctx;
    await SaleSettings.create({
      business,
      pipelineStages: ["Hot Lead", "Site Visited", "Converted", "Lost"].map((name, order) => ({ _id: new mongoose.Types.ObjectId(), name, order })),
      leadSources: [{ _id: new mongoose.Types.ObjectId(), name: "Billboard Ad" }],
    });
    const settings = (await call(getSettings)).payload.settings;
    const stages = settings.pipelineStages.filter((s) => s.isActive !== false).sort((a, b) => a.order - b.order);
    expect(nameToValue(stages[0].name)).toBe("hot_lead"); // new.tsx starts leads here
    for (const s of stages.filter((x) => nameToValue(x.name) !== "converted")) {
      const res = await call(createLead, { body: { fullName: `At ${s.name}`, source: nameToValue(settings.leadSources[0].name), status: nameToValue(s.name) } });
      expect(res.statusCode, s.name).toBe(201);
      expect(res.payload.status).toBe(nameToValue(s.name));
    }
    // a stage that does not exist is refused (not silently stored)
    await expect(call(createLead, { body: { fullName: "X", status: "not_a_stage" } })).rejects.toThrow(/Unknown lead status/);
  });

  it("settings: the shapes useSaleSettings reads (pipelineStages / leadSources with name, order, isActive; terminology on the company)", async () => {
    const ctx = await setup();
    const { call, company, user } = ctx;
    await call(loadDefaults, { body: {} }).catch(() => {}); // seeds Sale Settings; a fresh company also works via getSettings
    const { payload } = await call(getSettings);
    expect(Array.isArray(payload.settings.pipelineStages)).toBe(true);
    expect(Array.isArray(payload.settings.leadSources)).toBe(true);
    for (const s of payload.settings.pipelineStages) expect(typeof s.name).toBe("string");

    await callController(updateTerminology, { user, params: { businessId: String(company._id) }, body: { terminology: { saleDeal: "Sale", saleBuyer: "Client", saleLeads: "Prospects" } } });
    const cs = (await callController(getCompanySettings, { user, params: { businessId: String(company._id) } })).payload;
    const T = resolveTerms(cs.terminology);
    expect(T).toMatchObject({ saleDeal: "Sale", saleDeals: "Sales", saleBuyer: "Client", saleBuyers: "Clients", saleLeads: "Prospects", saleLead: "Lead", saleListing: "Listing" });
  });

  it("detail: the lead the screen renders, with populated listings / buyer and its activity log by relatedLead", async () => {
    const ctx = await setup();
    const { call, agent } = ctx;
    const listing = await ctx.mkListing();
    const lead = await ctx.mkLead({ assignedAgent: agent._id, interestedListings: [listing._id], nextFollowUpDate: new Date(Date.now() - 86_400_000), lastContactDate: new Date(), notes: "hi", budgetMax: 5_000_000 });
    const { payload: l } = await call(getLead, { params: { id: String(lead._id) } });
    for (const k of ["_id", "leadNumber", "fullName", "phone", "status", "source", "budgetMax", "notes", "nextFollowUpDate", "lastContactDate"]) expect(l[k], k).toBeDefined();
    expect(l.assignedAgent).toMatchObject({ fullName: "Jane Agent", phone: "0711000111" });
    expect(l.interestedListings[0]).toMatchObject({ listingNumber: listing.listingNumber, title: listing.title });
    expect(String(l.interestedListings[0]._id)).toBe(String(listing._id));
    expect(l.convertedBuyer ?? null).toBeNull();

    // load(): api.get('/sale/activities', { params: { relatedLead: id, limit: 100 } })
    const { payload: acts } = await call(listActivities, { query: { relatedLead: String(lead._id), limit: 100 } });
    expect(Array.isArray(acts.data)).toBe(true);
    expect(acts.data).toHaveLength(0);
  });

  it("log activity: the exact body leads/[id].tsx sends; it shows up in the lead's log and moves the lead's follow-up", async () => {
    const ctx = await setup();
    const { call } = ctx;
    const lead = await ctx.mkLead({ status: "new" });
    const day = "2026-09-20";
    const post = (over = {}) => call(createActivity, {
      body: {
        relatedLead: String(lead._id), type: "call", subject: "Intro call", notes: "Interested in a corner plot",
        date: activityDate(day), outcome: "positive", nextAction: "Send site plan", nextActionDate: "2026-10-01", ...over,
      },
    });
    const { statusCode, payload } = await post();
    expect(statusCode).toBe(201);
    expect(payload).toMatchObject({ type: "call", subject: "Intro call", outcome: "positive", nextAction: "Send site plan" });
    expect(payload.activityNumber).toMatch(/^ACT/);

    // the picked day survives the round trip in the phone's local time (midday, never a day off)
    const { payload: log } = await call(listActivities, { query: { relatedLead: String(lead._id), limit: 100 } });
    expect(log.data).toHaveLength(1);
    const a = log.data[0];
    expect(fmtDate(a.date)).toBe("20 Sep 2026");
    expect(new Date(a.nextActionDate).toISOString().slice(0, 10)).toBe("2026-10-01");
    for (const k of ["_id", "type", "subject", "notes", "date", "outcome", "nextAction", "nextActionDate"]) expect(a[k], k).toBeDefined();

    const fresh = await SaleLead.findById(lead._id).lean();
    expect(new Date(fresh.nextFollowUpDate).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(fresh.lastContactDate).toBeTruthy();

    // today keeps the current time; empty next-action fields (nextActionDate: null) are accepted
    const today = await post({ date: activityDate(todayISO()), nextAction: "", nextActionDate: null, subject: "", notes: "", outcome: "not_applicable" });
    expect(today.statusCode).toBe(201);
    expect(Math.abs(new Date(today.payload.date).getTime() - Date.now())).toBeLessThan(60_000);
    expect(today.payload.nextActionDate).toBeNull();
  });

  it("log activity: every type and outcome chip the sheet offers is accepted by the server enums", async () => {
    const ctx = await setup();
    const lead = await ctx.mkLead();
    for (const type of ACTIVITY_TYPES) {
      const res = await ctx.call(createActivity, { body: { relatedLead: String(lead._id), type, subject: "", notes: "", date: activityDate("2026-09-01"), outcome: "neutral", nextAction: "", nextActionDate: null } });
      expect(res.statusCode, type).toBe(201);
    }
    for (const outcome of ACTIVITY_OUTCOMES) {
      const res = await ctx.call(createActivity, { body: { relatedLead: String(lead._id), type: "note", subject: "", notes: "", date: activityDate("2026-09-01"), outcome, nextAction: "", nextActionDate: null } });
      expect(res.statusCode, outcome).toBe(201);
    }
  });

  it("change status: PUT { status } (and lostReason for lost) works; an unknown stage and 'converted' are not accepted", async () => {
    const ctx = await setup();
    const { call } = ctx;
    const lead = await ctx.mkLead({ status: "new" });
    const id = String(lead._id);
    const put = (body) => call(updateLead, { params: { id }, body });

    expect((await put({ status: "site_visited" })).payload.status).toBe("site_visited");
    const lost = await put({ status: "lost", lostReason: "Bought elsewhere" });
    expect(lost.payload).toMatchObject({ status: "lost", lostReason: "Bought elsewhere" });
    expect((await call(getLead, { params: { id } })).payload).toMatchObject({ status: "lost", lostReason: "Bought elsewhere" });
    // re-saving 'lost' with a new reason (saveStatus allows it)
    expect((await put({ status: "lost", lostReason: "Changed mind" })).payload.lostReason).toBe("Changed mind");
    await expect(put({ status: "not_a_stage" })).rejects.toThrow(/Unknown lead status/);
    // the mobile hides "converted" from the picker; the server ignores it here (it must go through /convert)
    expect((await put({ status: "converted" })).payload.status).toBe("lost");
  });

  it("convert: PATCH { idNumber } returns the buyer, locks the lead, and a second convert or a status change is refused", async () => {
    const ctx = await setup();
    const { call, business } = ctx;
    const lead = await ctx.mkLead({ fullName: "Peter Mwangi", phone: "0733222333", source: "referral", email: "p@example.com" });
    const id = String(lead._id);

    const { statusCode, payload } = await call(convertLead, { params: { id }, body: { idNumber: "12345678" } });
    expect(statusCode).toBe(200);
    expect(payload.message).toBe("Lead converted to buyer");
    expect(payload.buyer).toMatchObject({ fullName: "Peter Mwangi", phone: "0733222333", idNumber: "12345678", source: "referral" });
    expect(payload.buyer.buyerNumber).toMatch(/^BYR/);
    expect(await SaleBuyer.countDocuments({ business })).toBe(1);

    // convert with the empty string the sheet sends when the ID box is blank
    const blank = await ctx.mkLead();
    expect((await call(convertLead, { params: { id: String(blank._id) }, body: { idNumber: "" } })).statusCode).toBe(200);

    const { payload: after } = await call(getLead, { params: { id } });
    expect(after.status).toBe("converted");
    expect(after.convertedAt).toBeTruthy();
    expect(after.convertedBuyer).toMatchObject({ fullName: "Peter Mwangi" });
    expect(after.convertedBuyer.buyerNumber).toMatch(/^BYR/);

    await expect(call(convertLead, { params: { id }, body: { idNumber: "" } })).rejects.toThrow(/already converted/i);
    await expect(call(updateLead, { params: { id }, body: { status: "lost" } })).rejects.toThrow(/already been converted/i);
    expect(await SaleBuyer.countDocuments({ business })).toBe(2);
  });
});

// ── Deals (deals/index.tsx, deals/[id].tsx) ──────────────────────────────────────────────────────
describe("mobile contract: deals", () => {
  it("list: rows carry totalPaid / balance / nested names; status + search + paging params work", async () => {
    const ctx = await setup();
    const { call, business } = ctx;
    const a = await ctx.mkDeal({ price: 800_000, buyerOver: { fullName: "Wanjiru Njeri", phone: "0722111222" }, listingOver: { title: "Karen Villa" } });
    await ctx.mkDeal({ price: 500_000, status: "closed" });
    await SalePayment.create({ business, paymentNumber: "P-1", deal: a.deal._id, amount: 200_000, status: "paid" });
    await SalePayment.create({ business, paymentNumber: "P-2", deal: a.deal._id, amount: 999, status: "cancelled" }); // a voided payment is not "paid"

    const res = await call(listDeals, { query: { status: "active", search: undefined, page: 1, limit: 30 } });
    expect(res.statusCode).toBe(200);
    const page = pageOf(res.payload);
    expect(page.rows).toHaveLength(1);
    const d = page.rows[0];
    expect(d).toMatchObject({ agreedPrice: 800_000, totalPaid: 200_000, balance: 600_000, status: "active" });
    expect(d.dealNumber).toBe(a.deal.dealNumber);
    expect(d.listing.title).toBe("Karen Villa");
    expect(d.buyer).toMatchObject({ fullName: "Wanjiru Njeri", phone: "0722111222" });
    expect(d.agent.fullName).toBe("Jane Agent");
    expect(dealBalance(d)).toBe(600_000);

    // the search box text is matched against deal number, buyer and listing (phone written another way too)
    for (const search of ["wanj", "karen", "0722111222", a.deal.dealNumber]) {
      expect((await call(listDeals, { query: { status: "active", search, page: 1, limit: 30 } })).payload.total, search).toBe(1);
    }
    expect((await call(listDeals, { query: { status: "active", search: "nobody", page: 1, limit: 30 } })).payload.total).toBe(0);
    expect((await call(listDeals, { query: { search: "wanj", status: "closed" } })).payload.total).toBe(0);
    expect((await call(listDeals, { query: { page: 1, limit: 30 } })).payload.total).toBe(2); // the "All" tab
  });

  it("detail: every field deals/[id].tsx renders, plus its schedule and payments lists", async () => {
    const ctx = await setup();
    const { call, business } = ctx;
    const { deal } = await ctx.mkDeal({ price: 1_200_000, listingOver: { location: "Kitengela", town: "Kajiado", title: "Corner Plot" }, buyerOver: { fullName: "Anna", phone: "0700123456", email: "anna@example.com" } });
    await SaleDeal.updateOne({ _id: deal._id }, { expectedClosingDate: new Date("2026-12-01T00:00:00Z"), notes: "Rush" });
    const due = new Date(Date.now() - 5 * 86_400_000);
    await SalePaymentSchedule.create({ business, deal: deal._id, installmentNumber: 1, dueDate: due, expectedAmount: 400_000, description: "Deposit", status: "upcoming" });
    await SalePaymentSchedule.create({ business, deal: deal._id, installmentNumber: 2, dueDate: new Date(Date.now() + 20 * 86_400_000), expectedAmount: 800_000, status: "upcoming" });
    await SalePayment.create({ business, paymentNumber: "PMT-1", deal: deal._id, amount: 400_000, paymentType: "deposit", paymentMethod: "mpesa", reference: "QJ1X23ABC4D", status: "paid", paymentDate: new Date("2026-09-10T00:00:00Z") });

    const d = (await call(getDeal, { params: { id: String(deal._id) } })).payload;
    expect(d).toMatchObject({ agreedPrice: 1_200_000, totalPaid: 400_000, balance: 800_000, status: "active", notes: "Rush" });
    expect(d.dealNumber).toBe(deal.dealNumber);
    expect(d.listing).toMatchObject({ title: "Corner Plot", location: "Kitengela", town: "Kajiado" });
    expect(d.listing.listingNumber).toBeTruthy();
    expect(d.buyer).toMatchObject({ fullName: "Anna", phone: "0700123456", email: "anna@example.com" });
    expect(d.buyer.buyerNumber).toBeTruthy();
    expect(d.agent).toMatchObject({ fullName: "Jane Agent", phone: "0711000111" });
    expect(d.dealDate).toBeTruthy();
    expect(d.expectedClosingDate).toBeTruthy();

    // api.get('/sale/schedule', { params: { dealId: id } })
    const sched = (await call(listSchedule, { query: { dealId: String(deal._id) } })).payload;
    expect(sched.data.map((s) => s.installmentNumber)).toEqual([1, 2]);
    expect(sched.data[0]).toMatchObject({ expectedAmount: 400_000, description: "Deposit", status: "overdue" }); // the server re-ages it
    expect(sched.data[1].status).toBe("upcoming");
    for (const s of sched.data) for (const k of ["_id", "installmentNumber", "dueDate", "expectedAmount", "status"]) expect(s[k], k).toBeDefined();

    // api.get('/sale/payments', { params: { deal: id, limit: 200 } })
    const pays = (await call(listPayments, { query: { deal: String(deal._id), limit: 200 } })).payload;
    expect(pays.data).toHaveLength(1);
    expect(pays.data[0]).toMatchObject({ paymentNumber: "PMT-1", amount: 400_000, paymentType: "deposit", paymentMethod: "mpesa", reference: "QJ1X23ABC4D", status: "paid" });
    expect(pays.data[0].paymentDate).toBeTruthy();
    expect(pays.data[0]._id).toBeTruthy();
    expect(pays.totalCollected).toBe(400_000);
  });

  it("record payment: the exact body deals/[id].tsx sends; the deal, its payments and the ledger see it", async () => {
    const ctx = await setup();
    const { call, business } = ctx;
    const { deal } = await ctx.mkDeal({ price: 1_000_000 });
    const bank = await ctx.mkCashbook({ name: "Equity Bank" });
    const cashbooks = [{ _id: String(bank._id), name: bank.name, code: bank.code }];
    // the screen pre-selects the method's own cashbook
    expect(preferredCashbook(cashbooks, "bank", {})).toBe(String(bank._id));

    const body = {
      deal: String(deal._id), amount: round2(parseFloat("250000.5")), paymentType: "deposit", paymentMethod: "bank_transfer",
      paymentDate: "2026-09-25", cashbook: String(bank._id), reference: "RTGS/001/2026", notes: undefined,
    };
    const { statusCode, payload } = await call(createPayment, { body });
    expect(statusCode).toBe(201);
    expect(payload).toMatchObject({ amount: 250_000.5, paymentType: "deposit", paymentMethod: "bank_transfer", reference: "RTGS/001/2026", status: "paid" });
    expect(new Date(payload.paymentDate).toISOString().slice(0, 10)).toBe("2026-09-25");
    expect(payload.paymentNumber).toMatch(/^PMT/);

    const d = (await call(getDeal, { params: { id: String(deal._id) } })).payload;
    expect(d).toMatchObject({ totalPaid: 250_000.5, balance: 749_999.5 });
    expect(dealBalance(d)).toBe(749_999.5);
    expect((await call(listPayments, { query: { deal: String(deal._id), limit: 200 } })).payload.data).toHaveLength(1);
    expect(await SalePayment.countDocuments({ business, deal: deal._id, status: "paid", cashbook: bank._id })).toBe(1);
  });

  it("record payment: every type and method chip is accepted; the 'Full balance' button amount is accepted", async () => {
    const ctx = await setup();
    const { call } = ctx;
    const { deal } = await ctx.mkDeal({ price: 100_000 });
    const bank = await ctx.mkCashbook();
    for (const paymentType of PAYMENT_TYPES) {
      const res = await call(createPayment, { body: { deal: String(deal._id), amount: 1_000, paymentType, paymentMethod: "cash", paymentDate: "2026-09-25", cashbook: String(bank._id) } });
      expect(res.statusCode, paymentType).toBe(201);
    }
    for (const paymentMethod of PAYMENT_METHODS) {
      const res = await call(createPayment, { body: { deal: String(deal._id), amount: 1_000, paymentType: "installment", paymentMethod, paymentDate: "2026-09-25", cashbook: String(bank._id) } });
      expect(res.statusCode, paymentMethod).toBe(201);
    }
    // "Full balance": String(round2(balance)) parsed back
    const fresh = (await call(getDeal, { params: { id: String(deal._id) } })).payload;
    const full = round2(parseFloat(String(round2(dealBalance(fresh)))));
    expect((await call(createPayment, { body: { deal: String(deal._id), amount: full, paymentType: "final_payment", paymentMethod: "bank_transfer", paymentDate: "2026-09-25", cashbook: String(bank._id) } })).statusCode).toBe(201);
    expect(dealBalance((await call(getDeal, { params: { id: String(deal._id) } })).payload)).toBe(0);
  });

  it("record payment without a cashbook (the 'No cashbook account found' case) posts to the default account", async () => {
    const ctx = await setup();
    const { statusCode, payload } = await ctx.call(createPayment, {
      body: { deal: String((await ctx.mkDeal({ price: 50_000 })).deal._id), amount: 10_000, paymentType: "installment", paymentMethod: "cash", paymentDate: "2026-09-25", cashbook: undefined, reference: undefined, notes: undefined },
    });
    expect(statusCode).toBe(201);
    expect(payload.cashbook ?? null).toBeNull();
  });

  it("record payment failures the sheet relies on: over the balance, unknown cashbook, closed deal, other business's deal", async () => {
    const ctx = await setup();
    const { call, business } = ctx;
    const { deal } = await ctx.mkDeal({ price: 100_000 });
    const bank = await ctx.mkCashbook();
    const pay = (over) => call(createPayment, { body: { deal: String(deal._id), amount: 1_000, paymentType: "installment", paymentMethod: "cash", paymentDate: "2026-09-25", cashbook: String(bank._id), ...over } });

    await expect(pay({ amount: 100_000.5 })).rejects.toThrow(/exceeds remaining balance/); // the app also stops this earlier
    expect((await pay({ amount: 100_000.01 })).statusCode).toBe(201); // ...but tolerates the 1 cent the app allows (amt > balance + 0.01)
    await expect(pay({ amount: 5 })).rejects.toThrow(/exceeds remaining balance/); // now the deal is fully paid

    const { deal: d2 } = await ctx.mkDeal({ price: 100_000 });
    const foreign = await ChartOfAccount.create({ business: (await createTestCompany())._id, code: "1999", name: "Other Co Bank", type: "asset", group: "assets", subGroup: "Cashbooks" });
    await expect(call(createPayment, { body: { deal: String(d2._id), amount: 10, paymentType: "installment", paymentMethod: "cash", paymentDate: "2026-09-25", cashbook: String(foreign._id) } })).rejects.toThrow(/cashbook account not found/i);
    expect(await SalePayment.countDocuments({ business, deal: d2._id })).toBe(0);

    await SaleDeal.updateOne({ _id: d2._id }, { status: "closed" });
    await expect(call(createPayment, { body: { deal: String(d2._id), amount: 10, paymentType: "installment", paymentMethod: "cash", paymentDate: "2026-09-25" } })).rejects.toThrow(/only be recorded for active deals/);

    const other = await setup();
    const foreignDeal = await other.mkDeal({ price: 10_000 });
    await expect(call(createPayment, { body: { deal: String(foreignDeal.deal._id), amount: 10, paymentType: "installment", paymentMethod: "cash", paymentDate: "2026-09-25" } })).rejects.toThrow(/Deal not found/);
  });

  it("close: PATCH {} on a fully paid deal closes it, sells the listing and approves the commission; unpaid or repeat closes are refused", async () => {
    const ctx = await setup();
    const { call, business, agent } = ctx;
    const { deal, listing } = await ctx.mkDeal({ price: 300_000 });
    await SaleCommission.create({ business, commissionNumber: "C-9", deal: deal._id, agent: agent._id, saleAmount: 300_000, commissionRate: 3, commissionAmount: 9_000 });
    const bank = await ctx.mkCashbook();
    const id = String(deal._id);

    // not fully paid yet: the screen shows "Record Payment", but the server must refuse anyway
    await SalePayment.create({ business, paymentNumber: "P-1", deal: deal._id, amount: 100_000, paymentType: "deposit", status: "paid", cashbook: bank._id });
    await expect(call(closeDeal, { params: { id }, body: {} })).rejects.toThrow(/Outstanding balance/);
    expect((await SaleDeal.findById(id).lean()).status).toBe("active");

    await call(createPayment, { body: { deal: id, amount: 200_000, paymentType: "final_payment", paymentMethod: "bank_transfer", paymentDate: "2026-09-25", cashbook: String(bank._id) } });
    const res = await call(closeDeal, { params: { id }, body: {} });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ status: "closed", balance: 0 });

    const d = (await call(getDeal, { params: { id } })).payload;
    expect(d).toMatchObject({ status: "closed", totalPaid: 300_000, balance: 0 });
    expect(d.actualClosingDate).toBeTruthy(); // "Closed on"
    expect((await SaleListing.findById(listing._id).lean()).status).toBe("sold");
    expect((await SaleCommission.findOne({ deal: deal._id }).lean()).status).toBe("approved");

    await expect(call(closeDeal, { params: { id }, body: {} })).rejects.toThrow(/already closed/);
    await expect(call(createPayment, { body: { deal: id, amount: 1, paymentType: "other", paymentMethod: "cash", paymentDate: "2026-09-25" } })).rejects.toThrow(/active deals/);
  });
});

// ── Listings (listings/index.tsx, listings/[id].tsx) ─────────────────────────────────────────────
describe("mobile contract: listings", () => {
  it("list: rows + the per-status stats the tab badges read, filtered by status and search", async () => {
    const ctx = await setup();
    const { call, project, agent } = ctx;
    await ctx.mkListing({ title: "Corner plot", unitNumber: "A12", block: "A", project: project._id, location: "Kitengela", status: "available", size: 50, sizeUnit: "acres", titleDeedAvailable: true, negotiable: true, propertyType: "plot" });
    await ctx.mkListing({ title: "Maisonette", location: "Runda", status: "sold", propertyType: "house", assignedAgent: agent._id });
    await ctx.mkListing({ title: "Studio", status: "available", propertyType: "apartment" });

    const { statusCode, payload } = await call(listListings, { query: { status: "available", search: undefined, page: 1, limit: 30 } });
    expect(statusCode).toBe(200);
    const page = pageOf(payload);
    expect(page.total).toBe(2);
    // parse() in the screen reads data.stats[status].count; the count ignores the status filter so every tab has a number
    expect(payload.stats).toMatchObject({ available: { count: 2 }, sold: { count: 1 }, reserved: { count: 0 }, under_contract: { count: 0 }, withdrawn: { count: 0 } });
    const row = page.rows.find((r) => r.title === "Corner plot");
    for (const k of ["_id", "listingNumber", "title", "propertyType", "location", "askingPrice", "negotiable", "status", "unitNumber", "block", "titleDeedAvailable", "size", "sizeUnit"]) expect(row[k], k).toBeDefined();
    expect(row.project.name).toBe("Kitengela Plots");
    expect(page.rows.find((r) => r.title === "Studio").effectiveAgent).toBeNull();
    expect((await call(listListings, { query: { status: "sold", page: 1, limit: 30 } })).payload.data[0].effectiveAgent.fullName).toBe("Jane Agent");

    const titles = async (search, status) => (await call(listListings, { query: { status, search, page: 1, limit: 30 } })).payload.data.map((l) => l.title);
    expect(await titles("kiteng", "")).toEqual(["Corner plot"]);
    expect(await titles("a12", "available")).toEqual(["Corner plot"]);
    expect(await titles("house", "")).toEqual(["Maisonette"]);
    expect(await titles("house", "available")).toEqual([]);
  });

  it("detail: the fields listings/[id].tsx reads, with the project's agent when the unit has none", async () => {
    const ctx = await setup();
    const { call, agent, business } = ctx;
    const project = await SaleProject.create({ business, projectNumber: "PRJ-9", name: "Athi River", assignedAgent: agent._id });
    const listing = await ctx.mkListing({ title: "Unit 5", project: project._id, unitNumber: "5", block: "B", location: "Athi", town: "Machakos", county: "Machakos", description: "Nice", notes: "n", amenities: ["Water", "Fence"], titleDeedAvailable: true, titleDeedNumber: "TD/123", size: 0.5, sizeUnit: "acres" });
    const l = (await call(getListing, { params: { id: String(listing._id) } })).payload;
    for (const k of ["listingNumber", "title", "propertyType", "description", "size", "sizeUnit", "location", "town", "county", "askingPrice", "negotiable", "status", "titleDeedAvailable", "titleDeedNumber", "amenities", "unitNumber", "block", "listedDate", "notes"]) expect(l[k], k).toBeDefined();
    expect(l.amenities).toEqual(["Water", "Fence"]);
    expect(l.project).toMatchObject({ name: "Athi River", projectNumber: "PRJ-9" });
    expect(l.effectiveAgent.fullName).toBe("Jane Agent");
    expect(l.agentInherited).toBe(true);
  });
});

// ── Agent-scoped users (the company default keeps them to their own records) ─────────────────────
describe("mobile contract: agent-scoped user", () => {
  it("cannot read, pay, close or list another agent's deal; lists and totals only count their own", async () => {
    const ctx = await setup();
    const mine = await agentUser(ctx, "Mine");
    const theirs = await SaleAgent.create({ business: ctx.business, agentNumber: "AG-X", fullName: "Someone Else" });
    const my = await ctx.mkDeal({ price: 100_000, agent: mine.agent });
    const not = await ctx.mkDeal({ price: 200_000, agent: theirs });
    await SalePayment.create({ business: ctx.business, paymentNumber: "P-A", deal: my.deal._id, amount: 10_000, status: "paid" });
    await SalePayment.create({ business: ctx.business, paymentNumber: "P-B", deal: not.deal._id, amount: 20_000, status: "paid" });
    await SalePaymentSchedule.create({ business: ctx.business, deal: not.deal._id, installmentNumber: 1, dueDate: new Date(Date.now() - 86_400_000), expectedAmount: 200_000, status: "upcoming" });
    const foreignId = String(not.deal._id);

    expect((await mine.call(getDeal, { params: { id: String(my.deal._id) } })).payload.totalPaid).toBe(10_000);
    await expect(mine.call(getDeal, { params: { id: foreignId } })).rejects.toThrow(/Deal not found/);
    const list = (await mine.call(listDeals, { query: { status: "active", page: 1, limit: 30 } })).payload;
    expect(list.data.map((d) => d.dealNumber)).toEqual([my.deal.dealNumber]);
    expect((await mine.call(listDeals, { query: { search: not.buyer.fullName } })).payload.total).toBe(0);

    // detail sub-lists on someone else's deal: refused, and the refused call must not touch that deal's rows
    // (listing a schedule re-ages its statuses; that write only happens for a deal the caller may see)
    await expect(mine.call(listSchedule, { query: { dealId: foreignId } })).rejects.toThrow(/Deal not found/);
    expect((await SalePaymentSchedule.findOne({ deal: not.deal._id }).lean()).status).toBe("upcoming"); // not re-aged to "overdue"
    expect((await mine.call(listPayments, { query: { deal: foreignId, limit: 200 } })).payload.data).toEqual([]);
    expect((await mine.call(listPayments, { query: { deal: String(my.deal._id), limit: 200 } })).payload.data).toHaveLength(1);

    await expect(mine.call(createPayment, { body: { deal: foreignId, amount: 1, paymentType: "installment", paymentMethod: "cash", paymentDate: "2026-09-25" } })).rejects.toThrow(/Deal not found/);
    await expect(mine.call(closeDeal, { params: { id: foreignId }, body: {} })).rejects.toThrow(/Deal not found/);
    expect(await SalePayment.countDocuments({ deal: not.deal._id })).toBe(1);
    expect((await SaleDeal.findById(foreignId).lean()).status).toBe("active");

    const dash = (await mine.call(getDashboardStats)).payload;
    expect(dash.deals.active).toBe(1);
    expect(dash.deals.activeValue).toBe(100_000);
    expect(dash.payments.totalCollected).toBe(10_000);
    expect(dash.recentDeals.map((d) => d.dealNumber)).toEqual([my.deal.dealNumber]);
    const od = (await mine.call(getOverdueInstallments, { query: { limit: 5 } })).payload;
    expect(od.totals.count).toBe(0);
    expect((await ctx.call(getOverdueInstallments, { query: { limit: 5 } })).payload.totals.count).toBe(1); // the manager still sees it
  });

  it("cannot read, log on, change or convert another agent's lead; creating a lead assigns it to themselves", async () => {
    const ctx = await setup();
    const mine = await agentUser(ctx, "Mine");
    const theirs = await SaleAgent.create({ business: ctx.business, agentNumber: "AG-Y", fullName: "Someone Else" });
    const ownLead = await ctx.mkLead({ assignedAgent: mine.agent._id, status: "new" });
    const foreign = await ctx.mkLead({ assignedAgent: theirs._id, status: "new" });
    const fid = String(foreign._id);

    expect((await mine.call(listLeads, { query: { page: 1, limit: 30 } })).payload.data.map((l) => String(l._id))).toEqual([String(ownLead._id)]);
    expect((await mine.call(getPipeline)).payload.pipeline).toEqual([{ _id: "new", count: 1 }]);
    await expect(mine.call(getLead, { params: { id: fid } })).rejects.toThrow(/Lead not found/);
    await expect(mine.call(updateLead, { params: { id: fid }, body: { status: "lost" } })).rejects.toThrow(/Lead not found/);
    await expect(mine.call(convertLead, { params: { id: fid }, body: { idNumber: "" } })).rejects.toThrow(/Lead not found/);
    await expect(mine.call(createActivity, { body: { relatedLead: fid, type: "call", date: activityDate("2026-09-20"), outcome: "neutral" } })).rejects.toThrow(/Related lead not found/);
    expect((await SaleLead.findById(fid).lean()).status).toBe("new");

    // the activity log of a foreign lead is not readable through the list either
    await mine.call(createActivity, { body: { relatedLead: String(ownLead._id), type: "note", date: activityDate("2026-09-20") } });
    await ctx.call(createActivity, { body: { relatedLead: fid, type: "note", subject: "secret", date: activityDate("2026-09-20") } });
    expect((await mine.call(listActivities, { query: { relatedLead: fid, limit: 100 } })).payload.data).toEqual([]);
    expect((await mine.call(listActivities, { query: { relatedLead: String(ownLead._id), limit: 100 } })).payload.data).toHaveLength(1);

    // a lead created from the phone (even with another agent picked) belongs to the caller
    const made = await mine.call(createLead, { body: { fullName: "New Lead", source: "walk_in", status: "new", assignedAgent: String(theirs._id) } });
    expect(String(made.payload.assignedAgent)).toBe(String(mine.agent._id));

    // and their own lead converts fine
    expect((await mine.call(convertLead, { params: { id: String(ownLead._id) }, body: { idNumber: "" } })).statusCode).toBe(200);
  });
});
