// The search box on the tenant, maintenance, invoice and receipt lists finds records by what a person remembers: the tenant, the
// unit number, the property, a phone number typed in any format.
import { describe, it, expect } from "vitest";
import { getTenants } from "./tenants.js";
import { getMaintenances } from "./maintenance.js";
import { getTenantInvoicesList } from "./tenantInvoices.js";
import { getPayments } from "./rentPayment.js";
import Maintenance from "../../models/Maintenance.js";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import { callController } from "../../test/callController.js";
import { createTestInvoice, createTestReceipt } from "../../test/factories.landlord.js";
import { createTestUser } from "../../test/factories.js";
import { phoneSearchRegex } from "../../utils/listSearch.js";

const rowsOf = (payload) => (Array.isArray(payload) ? payload : payload?.data || payload?.items || payload?.tenants || []);

describe("list search", () => {
  it("phone-like terms match any stored format by their last 9 digits; other terms are not phone-like", () => {
    const re = phoneSearchRegex("0712345678");
    for (const stored of ["+254712345678", "0712 345 678", "254-712-345678", "0712345678"]) expect(re.test(stored)).toBe(true);
    expect(re.test("0799999999")).toBe(false);
    expect(phoneSearchRegex("A12")).toBeNull();
    expect(phoneSearchRegex("123")).toBeNull();
  });

  it("finds a tenant by unit number, by property name and by a phone number in another format", async () => {
    const bundle = await createTestInvoice({});
    const { tenant, unit, property, company } = bundle;
    await Unit.updateOne({ _id: unit._id }, { $set: { unitNumber: "ZX-77" } });
    await Property.updateOne({ _id: property._id }, { $set: { propertyName: "Mango Heights" } });
    await Tenant.updateOne({ _id: tenant._id }, { $set: { phone: "+254 712 345 678", name: "Grace Wanjiku" } });
    const user = await createTestUser({ company });
    const find = async (search) => rowsOf((await callController(getTenants, { user, query: { search } })).payload).map((t) => String(t._id));

    expect(await find("zx-77")).toContain(String(tenant._id));
    expect(await find("mango")).toContain(String(tenant._id));
    expect(await find("0712345678")).toContain(String(tenant._id));
    expect(await find("Wanjiku")).toContain(String(tenant._id));
    expect(await find("(no such tenant")).toEqual([]); // special characters do not break the search
  });

  it("finds a maintenance request by its unit, property or tenant", async () => {
    const { tenant, unit, property, company } = await createTestInvoice({});
    await Unit.updateOne({ _id: unit._id }, { $set: { unitNumber: "MT-9" } });
    await Property.updateOne({ _id: property._id }, { $set: { propertyName: "Baobab Court" } });
    await Tenant.updateOne({ _id: tenant._id }, { $set: { name: "Peter Kamau" } });
    const user = await createTestUser({ company });
    const request = await Maintenance.create({ business: company._id, unit: unit._id, tenant: tenant._id, title: "Leak", description: "Kitchen tap", priority: "medium", createdBy: user._id });
    const find = async (search) => rowsOf((await callController(getMaintenances, { user, query: { search } })).payload).map((m) => String(m._id));

    expect(await find("leak")).toContain(String(request._id));
    expect(await find("mt-9")).toContain(String(request._id));
    expect(await find("baobab")).toContain(String(request._id));
    expect(await find("kamau")).toContain(String(request._id));
    expect(await find("nothing here")).toEqual([]);
  });

  it("finds invoices and receipts by tenant, unit and property with one search box", async () => {
    const bundle = await createTestInvoice({});
    const { tenant, unit, property, company, invoice } = bundle;
    await Unit.updateOne({ _id: unit._id }, { $set: { unitNumber: "IV-5" } });
    await Property.updateOne({ _id: property._id }, { $set: { propertyName: "Acacia Gardens" } });
    await Tenant.updateOne({ _id: tenant._id }, { $set: { name: "Lucy Achieng" } });
    const { receipt } = await createTestReceipt({ invoiceBundle: bundle });
    const user = await createTestUser({ company });

    const invoiceIds = async (search) => rowsOf((await callController(getTenantInvoicesList, { user, query: { search, paginate: "true" } })).payload).map((i) => String(i._id));
    for (const term of ["achieng", "iv-5", "acacia", invoice.invoiceNumber]) expect(await invoiceIds(term), `invoice search: ${term}`).toContain(String(invoice._id));
    expect(await invoiceIds("zzz-none")).toEqual([]);

    const receiptIds = async (search) => rowsOf((await callController(getPayments, { user, query: { search, page: "1", limit: "50" } })).payload).map((r) => String(r._id));
    for (const term of ["achieng", "iv-5", "acacia"]) expect(await receiptIds(term), `receipt search: ${term}`).toContain(String(receipt._id));
    expect(await receiptIds("zzz-none")).toEqual([]);
  });
});
