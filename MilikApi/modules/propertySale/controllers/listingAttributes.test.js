// Custom fields per property type: definitions in Sale Settings, values on the listing.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import { addPropertyType, getSettings, updatePropertyType } from "./settingsController.js";
import { createListing, getListing, updateListing } from "./listingsController.js";
import { createProject, generateUnits } from "./projectsController.js";
import { bulkImportListings } from "./bulkImportController.js";
import SaleListing from "../models/SaleListing.js";
import { cleanAttributes, sanitizeTypeConfig } from "../services/listingAttributes.js";

const VEHICLE_FIELDS = [
  { label: "Registration No.", kind: "text", required: true },
  { label: "Year", kind: "number" },
  { label: "Fuel", kind: "select", options: ["Petrol", "Diesel", "Petrol"] },
  { label: "Inspected", kind: "date" },
  { label: "Accident free", kind: "boolean" },
];

const setup = async () => {
  const company = await createTestCompany();
  const user = await createTestUser({ company });
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const { payload } = await call(addPropertyType, { body: { name: "Vehicle", fields: VEHICLE_FIELDS, hiddenFields: ["size", "titleDeed", "bogus"] } });
  const vehicle = payload.settings.propertyTypes.find((t) => t.name === "Vehicle");
  return { company, user, call, vehicle };
};

describe("field definitions (pure)", () => {
  it("derives stable unique keys, dedupes choices, drops unknown hidden groups", () => {
    const out = sanitizeTypeConfig({ fields: [{ label: "Year" }, { label: "Year" }, { label: "1st owner?" }, { label: "Fuel", kind: "select", options: ["A", "A", " B "] }], hiddenFields: ["size", "size", "x"] });
    expect(out.fields.map((f) => f.key)).toEqual(["year", "year_2", "st_owner", "fuel"]);
    expect(out.fields[3].options).toEqual(["A", "B"]);
    expect(out.hiddenFields).toEqual(["size"]);
    // an existing key is kept when the label changes
    expect(sanitizeTypeConfig({ fields: [{ key: "reg", label: "Plate" }] }).fields[0].key).toBe("reg");
  });

  it("rejects bad definitions", () => {
    expect(sanitizeTypeConfig({ fields: [{ label: " " }] }).error).toMatch(/needs a name|Every extra field/);
    expect(sanitizeTypeConfig({ fields: [{ label: "F", kind: "select", options: [] }] }).error).toMatch(/at least one choice/);
    expect(sanitizeTypeConfig({ fields: Array.from({ length: 21 }, (_, i) => ({ label: `F${i}` })) }).error).toMatch(/at most 20/);
    expect(sanitizeTypeConfig({ fields: "nope" }).error).toMatch(/must be a list/);
  });

  it("coerces and validates values", () => {
    const fields = sanitizeTypeConfig({ fields: VEHICLE_FIELDS }).fields;
    const ok = cleanAttributes(fields, { registration_no: " KDA 123A ", year: "2018", fuel: "Diesel", inspected: "2026-03-05T10:00:00Z", accident_free: "true", junk: "x" });
    expect(ok.attributes).toEqual({ registration_no: "KDA 123A", year: 2018, fuel: "Diesel", inspected: "2026-03-05", accident_free: true });
    expect(cleanAttributes(fields, {}).error).toMatch(/Registration No\. is required/);
    expect(cleanAttributes(fields, {}, { enforceRequired: false }).attributes).toEqual({});
    expect(cleanAttributes(fields, { registration_no: "A", year: "abc" }).error).toMatch(/Year must be a number/);
    expect(cleanAttributes(fields, { registration_no: "A", fuel: "Water" }).error).toMatch(/Fuel must be one of/);
    expect(cleanAttributes(fields, { registration_no: "A", inspected: "not a date" }).error).toMatch(/valid date/);
  });
});

describe("property types with custom fields", () => {
  it("stores the definitions and rejects duplicates / bad input", async () => {
    const { call, vehicle } = await setup();
    expect(vehicle.fields.map((f) => f.key)).toEqual(["registration_no", "year", "fuel", "inspected", "accident_free"]);
    expect(vehicle.fields[2].options).toEqual(["Petrol", "Diesel"]);
    expect(vehicle.hiddenFields).toEqual(["size", "titleDeed"]);
    await expect(call(addPropertyType, { body: { name: "vehicle" } })).rejects.toThrow(/already exists/);
    await expect(call(addPropertyType, { body: { name: "Boat", fields: [{ label: "Type", kind: "select" }] } })).rejects.toThrow(/at least one choice/);
    await expect(call(addPropertyType, { body: { name: "" } })).rejects.toThrow(/Name is required/);
  });

  it("keeps fields on a name-only edit, and keeps a field's key when its label is renamed", async () => {
    const { call, vehicle } = await setup();
    const renamed = await call(updatePropertyType, { params: { itemId: String(vehicle._id) }, body: { name: "Car" } });
    const car = renamed.payload.settings.propertyTypes.find((t) => t.name === "Car");
    expect(car.fields).toHaveLength(5);
    const edited = await call(updatePropertyType, {
      params: { itemId: String(vehicle._id) },
      body: { fields: [{ key: "registration_no", label: "Plate", kind: "text", required: true }], hiddenFields: [] },
    });
    const t = edited.payload.settings.propertyTypes[0];
    expect(t.fields.map((f) => [f.key, f.label])).toEqual([["registration_no", "Plate"]]);
    expect(t.hiddenFields).toEqual([]);
    const settings = (await call(getSettings, {})).payload.settings;
    expect(settings.propertyTypes[0].fields).toHaveLength(1);
  });
});

describe("listings with custom fields", () => {
  const body = (extra = {}) => ({ title: "Toyota Prado", propertyType: "vehicle", askingPrice: 5000000, ...extra });

  it("validates required fields and coerces values on create", async () => {
    const { call } = await setup();
    await expect(call(createListing, { body: body() })).rejects.toThrow(/Registration No\. is required/);
    await expect(call(createListing, { body: body({ attributes: { registration_no: "KDA 1", year: "x" } }) })).rejects.toThrow(/Year must be a number/);
    const { payload } = await call(createListing, { body: body({ attributes: { registration_no: "KDA 1", year: "2018", fuel: "Diesel", accident_free: true, hacked: "<b>" } }) });
    expect(payload.attributes).toEqual({ registration_no: "KDA 1", year: 2018, fuel: "Diesel", accident_free: true });
    const again = await call(getListing, { params: { id: String(payload._id) } });
    expect(again.payload.attributes.year).toBe(2018);
  });

  it("ignores attributes for a type that defines none (and for an unknown type)", async () => {
    const { call } = await setup();
    const plot = await call(createListing, { body: { title: "Plot", propertyType: "plot", askingPrice: 1, attributes: { registration_no: "X" } } });
    expect(plot.payload.attributes ?? {}).toEqual({});
    const odd = await call(createListing, { body: { title: "Odd", propertyType: "spaceship", askingPrice: 1, attributes: { a: 1 } } });
    expect(odd.payload.attributes ?? {}).toEqual({});
  });

  it("updates values, keeps them on an unrelated edit, and clears them when the type changes", async () => {
    const { call } = await setup();
    const created = (await call(createListing, { body: body({ attributes: { registration_no: "KDA 1", year: 2018 } }) })).payload;
    const id = String(created._id);

    const changed = await call(updateListing, { params: { id }, body: { attributes: { registration_no: "KDB 2", year: "2020" } } });
    expect(changed.payload.attributes).toEqual({ registration_no: "KDB 2", year: 2020 });
    await expect(call(updateListing, { params: { id }, body: { attributes: { year: 2021 } } })).rejects.toThrow(/Registration No\. is required/);

    // an unrelated edit leaves the values alone
    const price = await call(updateListing, { params: { id }, body: { askingPrice: 4800000 } });
    expect(price.payload.attributes).toEqual({ registration_no: "KDB 2", year: 2020 });

    // switching to a type without those fields clears them
    const moved = await call(updateListing, { params: { id }, body: { propertyType: "plot" } });
    expect(moved.payload.attributes ?? {}).toEqual({});
    expect(((await SaleListing.findById(id).lean()).attributes) ?? {}).toEqual({});
  });

  it("imports extra columns into the type's fields, validating them like the form", async () => {
    const { call } = await setup();
    const { payload } = await call(bulkImportListings, {
      body: [
        // header match ignores case and the "*" marker; a key also works
        { title: "Prado A", propertyType: "Vehicle", askingPrice: 5000000, extra: { "Registration No. *": "KDA 1", YEAR: "2019", fuel: "Diesel", ignored: "x" } },
        { title: "Prado B", propertyType: "vehicle", askingPrice: 4000000, extra: { registration_no: "KDB 2" } },
        { title: "Prado C", propertyType: "vehicle", askingPrice: 3000000, extra: { Year: "2015" } },            // required missing
        { title: "Prado D", propertyType: "vehicle", askingPrice: 3000000, extra: { "Registration No.": "K", Fuel: "Water" } }, // bad choice
        { title: "Plot E", propertyType: "plot", askingPrice: 100, extra: { "Registration No.": "ignored" } },   // type without fields
      ],
    });
    expect(payload.successful.map((s) => s.title).sort()).toEqual(["Plot E", "Prado A", "Prado B"]);
    expect(payload.failed.map((f) => [f.title, f.error])).toEqual([
      ["Prado C", "Registration No. is required"],
      ["Prado D", expect.stringMatching(/Fuel must be one of/)],
    ].sort((a, b) => a[0].localeCompare(b[0])));
    const a = await SaleListing.findOne({ title: "Prado A" }).lean();
    expect(a).toMatchObject({ propertyType: "vehicle", attributes: { registration_no: "KDA 1", year: 2019, fuel: "Diesel" } });
    expect((await SaleListing.findOne({ title: "Prado B" }).lean()).attributes).toEqual({ registration_no: "KDB 2" });
    expect((await SaleListing.findOne({ title: "Plot E" }).lean()).attributes ?? {}).toEqual({});
  });

  it("generated units can share values (required fields are not enforced for a batch)", async () => {
    const { call } = await setup();
    const project = (await call(createProject, { body: { name: "Showroom" } })).payload;
    const gen = await call(generateUnits, {
      params: { id: String(project._id) },
      body: { prefix: "C-", from: 1, to: 3, askingPrice: 1000000, propertyType: "vehicle", attributes: { fuel: "Petrol", year: "2022", junk: 1 } },
    });
    expect(gen.payload.created).toBe(3);
    const unit = await SaleListing.findOne({ project: project._id, unitNumber: "C-2" }).lean();
    expect(unit.attributes).toEqual({ fuel: "Petrol", year: 2022 });
    await expect(call(generateUnits, {
      params: { id: String(project._id) },
      body: { prefix: "D-", from: 1, to: 2, askingPrice: 1, propertyType: "vehicle", attributes: { fuel: "Water" } },
    })).rejects.toThrow(/Fuel must be one of/);
  });
});
