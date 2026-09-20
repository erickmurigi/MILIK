// Integration tests for PropertySale projects/units (a unit is a SaleListing that belongs to a SaleProject).
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import SaleListing from "../models/SaleListing.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import {
  applyProjectDetails, assignUnits, createProject, deleteProject, detachUnit, generateUnits,
  getProject, listProjects, listProjectUnits, removeProjectImage, setProjectArchived, updateProject, updateUnitPrices,
  uploadProjectImages,
} from "./projectsController.js";
import { createListing, listListings, updateListing } from "./listingsController.js";

const setup = async () => {
  const company = await createTestCompany();
  const user = await createTestUser({ company });
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const { payload: project } = await call(createProject, {
    body: { name: "Sunrise Estate", location: "Kitengela", town: "Kajiado", county: "Kajiado" },
  });
  return { company, user, call, project };
};

const generate = (call, project, body) =>
  call(generateUnits, { params: { id: String(project._id) }, body: { prefix: "A-", from: 1, to: 5, askingPrice: 1000000, size: 50, ...body } });

describe("projects", () => {
  it("creates a numbered project, rejects a duplicate name and a blank name", async () => {
    const { call, project } = await setup();
    expect(project.projectNumber).toMatch(/^PRJ-/);
    expect(project.units.total).toBe(0);
    await expect(call(createProject, { body: { name: "sunrise estate" } })).rejects.toThrow(/already exists/);
    await expect(call(createProject, { body: { name: "  " } })).rejects.toThrow(/name is required/);
    await expect(call(createProject, { body: { name: "X", targetUnits: -1 } })).rejects.toThrow(/Target units/);
  });

  it("generates units, skips ones that already exist, and copies the project location", async () => {
    const { call, project } = await setup();
    const first = await generate(call, project, {});
    expect(first.statusCode).toBe(201);
    expect(first.payload).toMatchObject({ created: 5, skipped: 0 });

    // overlapping range: 3..7 -> only 6 and 7 are new
    const second = await generate(call, project, { from: 3, to: 7 });
    expect(second.payload).toMatchObject({ created: 2, skipped: 3, requested: 5 });

    const { payload } = await call(listProjectUnits, { params: { id: String(project._id) } });
    expect(payload.total).toBe(7);
    // natural order: A-2 before A-10 style ordering is numeric-aware
    expect(payload.data.map((u) => u.unitNumber)).toEqual(["A-1", "A-2", "A-3", "A-4", "A-5", "A-6", "A-7"]);

    const unit = await SaleListing.findOne({ project: project._id, unitNumber: "A-1" }).lean();
    expect(unit).toMatchObject({ title: "Sunrise Estate – A-1", location: "Kitengela", county: "Kajiado", status: "available", askingPrice: 1000000 });
    expect(new Set((await SaleListing.find({ project: project._id }).lean()).map((u) => u.listingNumber)).size).toBe(7);
  });

  it("validates the generate request", async () => {
    const { call, project } = await setup();
    await expect(generate(call, project, { from: 5, to: 1 })).rejects.toThrow(/valid unit range/);
    await expect(generate(call, project, { from: 1, to: 600 })).rejects.toThrow(/at most 500/);
    await expect(generate(call, project, { askingPrice: "" })).rejects.toThrow(/Asking price/);
    await expect(generate(call, project, { sizeUnit: "miles" })).rejects.toThrow();
    const archived = await call(setProjectArchived, { params: { id: String(project._id) }, body: { archived: true } });
    expect(archived.payload.status).toBe("archived");
    await expect(generate(call, project, {})).rejects.toThrow(/archived/);
  });

  it("does not let one company touch another company's project", async () => {
    const { project } = await setup();
    const other = await setup();
    await expect(other.call(getProject, { params: { id: String(project._id) } })).rejects.toThrow(/not found/i);
    await expect(other.call(generateUnits, { params: { id: String(project._id) }, body: { from: 1, to: 2, askingPrice: 1 } })).rejects.toThrow(/not found/i);
  });

  it("filters the listings list by project and keeps stats in scope", async () => {
    const { call, project } = await setup();
    await generate(call, project, { to: 3 });
    await call(createListing, { body: { title: "Standalone house", askingPrice: 5000000 } });

    const all = await call(listListings, {});
    expect(all.payload.total).toBe(4);
    const units = await call(listListings, { query: { project: "any" } });
    expect(units.payload.total).toBe(3);
    const standalone = await call(listListings, { query: { project: "none" } });
    expect(standalone.payload.total).toBe(1);
    expect(standalone.payload.stats.available.count).toBe(1);
    const one = await call(listListings, { query: { projectId: String(project._id), search: "A-2" } });
    expect(one.payload.data.map((u) => u.unitNumber)).toEqual(["A-2"]);
    expect(one.payload.data[0].project.name).toBe("Sunrise Estate");
    await expect(call(listListings, { query: { projectId: "nope" } })).rejects.toThrow(/Invalid project/);
  });

  it("creates a unit through the listing form, blocks duplicate numbers and moving a unit between projects", async () => {
    const { call, project } = await setup();
    const body = { title: "Manual plot", askingPrice: 900000, project: String(project._id), unitNumber: " B-1 ", block: "B" };
    const { payload } = await call(createListing, { body });
    expect(payload).toMatchObject({ unitNumber: "B-1", block: "B" });
    await expect(call(createListing, { body })).rejects.toThrow(/already exists in this project/);
    await expect(call(createListing, { body: { ...body, unitNumber: "" } })).rejects.toThrow(/Unit number is required/);
    await expect(call(createListing, { body: { ...body, project: String(new mongoose.Types.ObjectId()) } })).rejects.toThrow(/Project not found/);

    // update cannot re-point the project, and unit number cannot be blanked
    const otherProject = (await call(createProject, { body: { name: "Other" } })).payload;
    const updated = await call(updateListing, { params: { id: String(payload._id) }, body: { project: String(otherProject._id), askingPrice: 950000 } });
    expect(String(updated.payload.project._id)).toBe(String(project._id));
    expect(updated.payload.askingPrice).toBe(950000);
    await expect(call(updateListing, { params: { id: String(payload._id) }, body: { unitNumber: "" } })).rejects.toThrow(/Unit number is required/);

    // a standalone listing ignores unit fields
    const standalone = (await call(createListing, { body: { title: "House", askingPrice: 1, unitNumber: "Z9" } })).payload;
    expect(standalone.unitNumber).toBe("");
  });

  it("groups existing listings into a project and reports per-item problems", async () => {
    const { call, project } = await setup();
    const a = (await call(createListing, { body: { title: "Loose A", askingPrice: 1 } })).payload;
    const b = (await call(createListing, { body: { title: "Loose B", askingPrice: 1 } })).payload;
    await generate(call, project, { to: 1 }); // A-1 exists

    const { payload } = await call(assignUnits, {
      params: { id: String(project._id) },
      body: { items: [
        { listingId: String(a._id), unitNumber: "A-1" },      // taken
        { listingId: String(b._id), unitNumber: "N-7", block: "N" },
        { listingId: String(new mongoose.Types.ObjectId()), unitNumber: "Q" }, // unknown
      ] },
    });
    expect(payload.assigned).toBe(1);
    expect(payload.failed).toHaveLength(2);
    expect(await SaleListing.findById(b._id).lean()).toMatchObject({ unitNumber: "N-7", block: "N" });
    // already in a project -> cannot be assigned again
    const again = await call(assignUnits, { params: { id: String(project._id) }, body: { items: [{ listingId: String(b._id), unitNumber: "N-8" }] } });
    expect(again.payload.assigned).toBe(0);
  });

  it("bulk-prices only available units", async () => {
    const { call, project } = await setup();
    await generate(call, project, { to: 3, block: "Phase 1", askingPrice: 1000 });
    await SaleListing.updateOne({ project: project._id, unitNumber: "A-2" }, { status: "reserved" });
    await SaleListing.updateOne({ project: project._id, unitNumber: "A-3" }, { status: "sold" });

    const r = await call(updateUnitPrices, { params: { id: String(project._id) }, body: { mode: "percent", value: 10 } });
    expect(r.payload.updated).toBe(1);
    const prices = Object.fromEntries((await SaleListing.find({ project: project._id }).lean()).map((u) => [u.unitNumber, u.askingPrice]));
    expect(prices).toEqual({ "A-1": 1100, "A-2": 1000, "A-3": 1000 });

    await call(updateUnitPrices, { params: { id: String(project._id) }, body: { mode: "amount", value: -100 } });
    await call(updateUnitPrices, { params: { id: String(project._id) }, body: { mode: "set", value: 2500, block: "Nope" } });
    expect((await SaleListing.findOne({ project: project._id, unitNumber: "A-1" }).lean()).askingPrice).toBe(1000);
    await expect(call(updateUnitPrices, { params: { id: String(project._id) }, body: { mode: "percent", value: -100 } })).rejects.toThrow(/less than 100/);
    await expect(call(updateUnitPrices, { params: { id: String(project._id) }, body: { mode: "bogus", value: 1 } })).rejects.toThrow(/mode must be/);
  });

  it("copies edited project details to unsold units only", async () => {
    const { call, project } = await setup();
    await generate(call, project, { to: 2 });
    await SaleListing.updateOne({ project: project._id, unitNumber: "A-2" }, { status: "sold" });
    await call(updateProject, { params: { id: String(project._id) }, body: { location: "Athi River" } });
    const r = await call(applyProjectDetails, { params: { id: String(project._id) } });
    expect(r.payload.updated).toBe(1);
    const units = Object.fromEntries((await SaleListing.find({ project: project._id }).lean()).map((u) => [u.unitNumber, u.location]));
    expect(units).toEqual({ "A-1": "Athi River", "A-2": "Kitengela" });
  });

  it("derives sales figures from deals and payments, and lists progress on the project list", async () => {
    const { company, call, project } = await setup();
    await generate(call, project, { to: 4, askingPrice: 1000000 });
    const [u1, u2] = await SaleListing.find({ project: project._id }).sort({ unitNumber: 1 }).limit(2);
    const business = company._id;
    const listed = new Date(Date.now() - 30 * 86_400_000);
    await SaleListing.updateOne({ _id: u1._id }, { status: "sold", listedDate: listed });
    await SaleListing.updateOne({ _id: u2._id }, { status: "under_contract" });

    const buyer = new mongoose.Types.ObjectId();
    const d1 = await SaleDeal.create({ business, dealNumber: "D-1", listing: u1._id, buyer, agreedPrice: 900000, status: "closed", actualClosingDate: new Date() });
    const d2 = await SaleDeal.create({ business, dealNumber: "D-2", listing: u2._id, buyer, agreedPrice: 1000000, status: "active" });
    await SaleDeal.create({ business, dealNumber: "D-3", listing: u2._id, buyer, agreedPrice: 5, status: "cancelled" });
    await SalePayment.create({ business, paymentNumber: "P-1", deal: d1._id, amount: 900000, status: "paid" });
    await SalePayment.create({ business, paymentNumber: "P-2", deal: d2._id, amount: 300000, status: "paid" });
    await SalePayment.create({ business, paymentNumber: "P-3", deal: d2._id, amount: 999, status: "cancelled" });

    const { payload } = await call(getProject, { params: { id: String(project._id) } });
    expect(payload.units).toMatchObject({ total: 4, available: 2, under_contract: 1, sold: 1 });
    expect(payload.sellThrough).toBe(25);
    expect(payload.performance).toMatchObject({
      scoped: false, booked: 1900000, collected: 1200000, outstanding: 700000, closedDeals: 1, closedValue: 900000,
    });
    expect(payload.performance.priceRealisation).toBe(95); // 1.9M agreed vs 2.0M asking on the two dealt units
    expect(payload.performance.avgDaysToSell).toBe(30);
    expect(payload.performance.monthly).toHaveLength(12);
    expect(payload.performance.monthly.at(-1)).toMatchObject({ closed: 1, closedValue: 900000, booked: 2 });

    const list = await call(listProjects, {});
    expect(list.payload.data[0]).toMatchObject({ name: "Sunrise Estate", sellThrough: 25 });
    expect(list.payload.data[0].units.total).toBe(4);
  });

  it("attaches and removes project photos, and keeps them private to the company", async () => {
    const { call, project } = await setup();
    const id = String(project._id);
    const up = await call(uploadProjectImages, { params: { id }, files: [{ filename: "a.jpg" }, { filename: "b.jpg" }] });
    expect(up.payload.images).toEqual(["/uploads/sale-listings/a.jpg", "/uploads/sale-listings/b.jpg"]);
    await expect(call(uploadProjectImages, { params: { id }, files: [] })).rejects.toThrow(/No valid images/);

    // photos come back on the project and the list, but a normal edit cannot overwrite them
    await call(updateProject, { params: { id }, body: { name: "Sunrise Estate", images: ["/x.jpg"] } });
    expect((await call(getProject, { params: { id } })).payload.images).toHaveLength(2);
    expect((await call(listProjects, {})).payload.data[0].images).toHaveLength(2);

    const other = await setup();
    await expect(other.call(uploadProjectImages, { params: { id }, files: [{ filename: "c.jpg" }] })).rejects.toThrow(/not found/i);
    await expect(other.call(removeProjectImage, { params: { id }, body: { url: "/uploads/sale-listings/a.jpg" } })).rejects.toThrow(/not found/i);

    const rm = await call(removeProjectImage, { params: { id }, body: { url: "/uploads/sale-listings/a.jpg" } });
    expect(rm.payload.images).toEqual(["/uploads/sale-listings/b.jpg"]);
    await expect(call(removeProjectImage, { params: { id }, body: { url: "/uploads/sale-listings/zzz.jpg" } })).rejects.toThrow(/Image not found/);
    await expect(call(removeProjectImage, { params: { id }, body: {} })).rejects.toThrow(/Image URL required/);
  });

  it("refuses to delete or detach units with a deal, and deletes an untouched project with its units", async () => {
    const { company, call, project } = await setup();
    await generate(call, project, { to: 2 });
    const [u1, u2] = await SaleListing.find({ project: project._id }).sort({ unitNumber: 1 });
    await SaleListing.updateOne({ _id: u1._id }, { status: "under_contract" });
    await SaleDeal.create({ business: company._id, dealNumber: "D-9", listing: u1._id, buyer: new mongoose.Types.ObjectId(), agreedPrice: 1, status: "active" });

    await expect(call(deleteProject, { params: { id: String(project._id) } })).rejects.toThrow(/archive it instead/);
    await expect(call(detachUnit, { params: { id: String(project._id), listingId: String(u1._id) } })).rejects.toThrow(/can't be removed/);

    // a clean unit can be detached and becomes standalone again
    await call(detachUnit, { params: { id: String(project._id), listingId: String(u2._id) } });
    expect(await SaleListing.findById(u2._id).lean()).toMatchObject({ project: null, unitNumber: "" });

    const empty = (await call(createProject, { body: { name: "Empty" } })).payload;
    await generate(call, empty, { to: 3 });
    const removed = await call(deleteProject, { params: { id: String(empty._id) } });
    expect(removed.payload.unitsDeleted).toBe(3);
    expect(await SaleListing.countDocuments({ project: empty._id })).toBe(0);
  });
});
