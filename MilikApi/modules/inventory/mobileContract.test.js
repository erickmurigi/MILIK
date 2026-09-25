// Contract between the mobile Inventory / POS screens (MilikMobile/app/(app)/inventory/**) and the real controllers.
// Every request below is built the way the mobile code builds it (same param / body objects, field names, enum values and
// day boundaries; query values are strings because axios serialises them) and answered by the real controller. Each test then
// asserts the exact keys the .tsx reads, so a renamed server field or a wrong enum on either side fails here.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestUser } from "../../test/factories.js";
import InvLocation from "./models/InvLocation.js";
import InvSupplier from "./models/InvSupplier.js";
import InvCategory from "./models/InvCategory.js";
import InvProduct from "./models/InvProduct.js";
import InvStockEntry from "./models/InvStockEntry.js";
import InvPurchaseOrder from "./models/InvPurchaseOrder.js";
import POSSession from "./models/POSSession.js";
import POSSale from "./models/POSSale.js";
import { listProducts, getProduct } from "./controllers/productsController.js";
import {
  createPurchaseOrder, listPurchaseOrders, getPurchaseOrder, updatePurchaseOrder, receiveGoods, cancelPurchaseOrder,
} from "./controllers/purchaseOrdersController.js";
import { createManualEntry, getLowStock, listStockMovements } from "./controllers/stockMovementsController.js";
import { createSale, listSales, salesSummary, voidSale } from "./controllers/posSalesController.js";
import { postStockEntry, getStockBalance } from "./services/stockLedger.js";
// The mobile helpers themselves, so a drift in a constant / rule / request builder is caught here.
import {
  MANUAL_TYPES, MOVEMENT_FILTERS, MOVEMENT_STYLE, PO_FILTERS, PO_STATUS, SALE_FILTERS,
  canCancelPO, canReceivePO, canSendPO, dayParams, fmtQty, isLowStock, markSentBody, marginPct, normalizeSummary,
  outstanding, priceInclVat, receiveBody, saleCustomer, shiftDay, stockEntryBody, userName, voidBody,
} from "../../../MilikMobile/utils/inventory.ts";
import { pageOf } from "../../../MilikMobile/utils/sales.ts";
import { todayISO } from "../../../MilikMobile/utils/pmsFormat.ts";

// ── how the mobile app sends things ─────────────────────────────────────────────────────────────
// axios: undefined / null params are dropped, everything is a string on the wire. usePmsList also drops '' and adds page / limit.
const wire = (o = {}) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
);
const json = (o = {}) => JSON.parse(JSON.stringify(o));

let seq = 0;

// createdAt is immutable in mongoose, so move a sale in time with the raw collection
const backdate = (id, at) => POSSale.collection.updateOne({ _id: id }, { $set: { createdAt: at } });

const setup = async () => {
  const company = await createTestCompany({ modules: { inventory: true } });
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, { query = {}, body = {}, params = {} } = {}) =>
    callController(fn, { user, query: wire(query), body: json(body), params, headers: {} });

  const main = await InvLocation.create({ business, name: "Main Store", code: "MAIN", type: "warehouse" });
  const shop = await InvLocation.create({ business, name: "Shop Floor", code: "SHOP", type: "retail" });
  const supplier = await InvSupplier.create({ business, name: "Kamau Traders", phone: "0712345678" });
  const category = await InvCategory.create({ business, name: "Beverages" });

  const mkProduct = (over = {}) => {
    const n = ++seq;
    return InvProduct.create({ business, name: `Product ${n}`, sku: `SKU${n}`, sellingPrice: 100, costPrice: 60, vatRate: 16, ...over });
  };
  const stock = (product, location, qty, over = {}) =>
    postStockEntry({ business, location: String(location._id), product: String(product._id), type: "opening", qty, unitCost: product.costPrice, createdBy: user._id, ...over });
  const openSession = (location = shop) =>
    POSSession.create({ business, location: location._id, sessionNumber: `S-${++seq}`, status: "open", openedBy: user._id });
  const sell = async (session, lines, over = {}) => {
    const { payload } = await call(createSale, {
      body: { location: String(session.location), session: String(session._id), lines, payments: [{ method: "cash", amount: 100_000 }], ...over },
    });
    return payload.data;
  };

  return { company, user, business, call, main, shop, supplier, category, mkProduct, stock, openSession, sell };
};

// ── Dashboard (inventory/index.tsx) ─────────────────────────────────────────────────────────────
describe("mobile contract: inventory dashboard", () => {
  it("sales summary for the local day carries the keys the tiles read; other days are excluded", async () => {
    const { call, mkProduct, stock, shop, openSession, sell } = await setup();
    const p = await mkProduct({ sellingPrice: 100, vatRate: 16 });
    await stock(p, shop, 50);
    const session = await openSession();
    await sell(session, [{ product: String(p._id), qty: 2 }], { customerName: "Wanjiku" });   // 200 + 32 VAT
    const old = await sell(session, [{ product: String(p._id), qty: 1 }]);
    // an old sale (2 days ago) must not count today
    await backdate(old._id, new Date(Date.now() - 2 * 86_400_000));

    const today = todayISO();
    const { statusCode, payload } = await call(salesSummary, { query: dayParams(today) });
    expect(statusCode).toBe(200);
    const s = normalizeSummary(payload.data);
    expect(s).toMatchObject({ count: 1, subtotal: 200, totalVat: 32, grandTotal: 232, totalDiscount: 0 });
    expect(s.byPaymentMethod).toEqual({ cash: 100_000 });

    const { payload: other } = await call(salesSummary, { query: dayParams(shiftDay(today, -2)) });
    expect(normalizeSummary(other.data).count).toBe(1);
    // no sales -> zeros, never NaN
    const { payload: empty } = await call(salesSummary, { query: dayParams(shiftDay(today, -10)) });
    expect(normalizeSummary(empty.data)).toMatchObject({ count: 0, grandTotal: 0, byPaymentMethod: {} });
  });

  it("dayParams selects exactly the device's local calendar day", async () => {
    const { call, mkProduct, stock, shop, openSession, sell } = await setup();
    const p = await mkProduct();
    await stock(p, shop, 50);
    const session = await openSession();
    const a = await sell(session, [{ product: String(p._id), qty: 1 }]);
    const b = await sell(session, [{ product: String(p._id), qty: 1 }]);
    const c = await sell(session, [{ product: String(p._id), qty: 1 }]);
    const day = todayISO();
    const start = new Date(dayParams(day).from);
    // just after local midnight = today, one minute before = yesterday, last minute of the day = today, next midnight = tomorrow
    await backdate(a._id, new Date(start.getTime() + 60_000));
    await backdate(b._id, new Date(start.getTime() - 60_000));
    await backdate(c._id, new Date(start.getTime() + 86_400_000 - 60_000));

    const { payload } = await call(listSales, { query: { ...dayParams(day), page: 1, limit: 30 } });
    expect(payload.data.map((s) => s._id.toString()).sort()).toEqual([String(a._id), String(c._id)].sort());
    const { payload: sum } = await call(salesSummary, { query: dayParams(day) });
    expect(sum.data.count).toBe(2);
  });

  it("low-stock: total + rows (product, balance, reorderLevel, deficit); products / PO counts read `total`", async () => {
    const { call, mkProduct, stock, main, supplier } = await setup();
    const low = await mkProduct({ reorderLevel: 10 });
    const ok = await mkProduct({ reorderLevel: 5 });
    const untracked = await mkProduct({ reorderLevel: 5, trackStock: false });
    await stock(low, main, 4);
    await stock(ok, main, 50);
    await stock(untracked, main, 1);

    const { payload } = await call(getLowStock);
    expect(payload.total).toBe(1);
    expect(Number(payload.total ?? payload.data.length)).toBe(1);
    const row = payload.data[0];
    expect(row).toMatchObject({ balance: 4, reorderLevel: 10, deficit: 6 });
    expect(row.product.name).toBe(low.name);
    expect(row.product._id).toBeTruthy();

    const { payload: prods } = await call(listProducts, { query: { limit: 1, active: "true" } });
    expect(prods.total).toBe(3);
    expect(prods.data).toHaveLength(1);

    await call(createPurchaseOrder, { body: { supplier: String(supplier._id), location: String(main._id), lines: [{ product: String(low._id), qtyOrdered: 5, unitCost: 60 }] } });
    const { payload: drafts } = await call(listPurchaseOrders, { query: { limit: 1, status: "draft" } });
    const { payload: sent } = await call(listPurchaseOrders, { query: { limit: 1, status: "sent" } });
    expect(drafts.total).toBe(1);
    expect(sent.total).toBe(0);
  });
});

// ── Products (products/index.tsx, products/[id].tsx) ────────────────────────────────────────────
describe("mobile contract: products", () => {
  it("list with withStock=true carries pagination the hook reads and a stockBalance the low-stock rule uses", async () => {
    const { call, mkProduct, stock, main, shop, category } = await setup();
    const a = await mkProduct({ name: "Fresh Milk 500ml", category: category._id, reorderLevel: 20, unitOfMeasure: "pcs" });
    const b = await mkProduct({ name: "Bread", reorderLevel: 0 });
    await stock(a, main, 10);
    await stock(a, shop, 5);          // total on hand across locations = 15 <= reorder level 20
    await stock(b, main, 3);

    const { statusCode, payload } = await call(listProducts, { query: { active: "true", withStock: "true", page: 1, limit: 40 } });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ total: 2, page: 1, pages: 1 });
    expect(pageOf(payload)).toMatchObject({ pages: 1, total: 2 });
    const milk = payload.data.find((p) => p.name === "Fresh Milk 500ml");
    expect(milk.stockBalance).toBe(15);
    expect(milk.category.name).toBe("Beverages");
    for (const k of ["_id", "name", "sku", "sellingPrice", "costPrice", "reorderLevel", "trackStock", "active", "unitOfMeasure"]) {
      expect(milk[k], k).not.toBeUndefined();
    }
    expect(isLowStock(milk)).toBe(true);
    const bread = payload.data.find((p) => p.name === "Bread");
    expect(bread.stockBalance).toBe(3);
    expect(isLowStock(bread)).toBe(false);          // no reorder level set

    // without withStock the server sends no balance -> the screen must not guess
    const { payload: plain } = await call(listProducts, { query: { limit: 40 } });
    expect(plain.data[0].stockBalance).toBeUndefined();
  });

  it("search finds substrings of name / SKU / barcode and needs every word; Active / Inactive chips filter", async () => {
    const { call, mkProduct } = await setup();
    await mkProduct({ name: "Fresh Milk 500ml", sku: "MLK500", barcode: "6001234567890" });
    await mkProduct({ name: "Fresh Bread", sku: "BRD1" });
    await mkProduct({ name: "Old Stock Item", active: false });
    const names = async (query) => (await call(listProducts, { query })).payload.data.map((p) => p.name);

    expect(await names({ search: "milk" })).toEqual(["Fresh Milk 500ml"]);
    expect(await names({ search: "ilk 50" })).toEqual(["Fresh Milk 500ml"]);        // substring, not whole words
    expect(await names({ search: "fresh 500" })).toEqual(["Fresh Milk 500ml"]);      // every word, any order
    expect(await names({ search: "mlk5" })).toEqual(["Fresh Milk 500ml"]);           // SKU
    expect(await names({ search: "60012345" })).toEqual(["Fresh Milk 500ml"]);       // barcode
    expect(await names({ search: "fresh" })).toHaveLength(2);
    expect(await names({ search: "milk (" })).toEqual([]);                            // regex characters are escaped, not an error

    expect(await names({ active: "true" })).toHaveLength(2);
    expect(await names({ active: "false" })).toEqual(["Old Stock Item"]);
    expect(await names({})).toHaveLength(3);                                          // the "All" chip sends no active param
  });

  it("detail (withStock=true): stockByLocation + total, pricing helpers, 404 for an unknown / foreign product", async () => {
    const ctx = await setup();
    const { call, mkProduct, stock, main, shop, category } = ctx;
    const p = await mkProduct({ name: "Sugar 1kg", category: category._id, sellingPrice: 200, costPrice: 150, vatRate: 8, reorderLevel: 30 });
    await stock(p, main, 12);
    await stock(p, shop, 8);
    await InvLocation.create({ business: ctx.business, name: "Closed Branch", type: "retail", active: false });

    const { payload } = await call(getProduct, { params: { id: String(p._id) }, query: { withStock: "true" } });
    const d = payload.data;
    expect(d.stockBalance).toBe(20);
    expect(d.stockByLocation).toHaveLength(2);                                        // active locations only
    for (const l of d.stockByLocation) {
      expect(typeof l.location).toBe("object");
      expect(typeof l.locationName).toBe("string");
      expect(typeof l.balance).toBe("number");
    }
    expect(d.stockByLocation.reduce((s, l) => s + l.balance, 0)).toBe(20);
    expect(d.category.name).toBe("Beverages");
    expect(isLowStock(d)).toBe(true);
    expect(priceInclVat(d)).toBe(216);
    expect(marginPct(d)).toBeCloseTo(25, 5);
    expect(marginPct({ sellingPrice: 0, costPrice: 5 })).toBeNull();

    await expect(call(getProduct, { params: { id: String(new mongoose.Types.ObjectId()) } })).rejects.toMatchObject({ status: 404 });
    const other = await setup();
    const foreign = await other.mkProduct();
    await expect(call(getProduct, { params: { id: String(foreign._id) }, query: { withStock: "true" } })).rejects.toMatchObject({ status: 404 });
  });
});

// ── Stock movements (stock-movements/index.tsx + the adjust form on products/[id].tsx) ─────────
describe("mobile contract: stock movements", () => {
  it("list rows carry signed qty, unitCost, product / location / createdBy; every filter chip is a type the server knows", async () => {
    const { call, mkProduct, stock, main, shop, user } = await setup();
    const p = await mkProduct({ name: "Fresh Milk 500ml", sku: "MLK500", unitOfMeasure: "pcs" });
    await stock(p, main, 20, { reference: "OPEN-1", unitCost: 55 });
    await postStockEntry({ business: main.business, location: String(main._id), product: String(p._id), type: "transfer_out", qty: -5, reference: "TRF-00001", createdBy: user._id });
    await postStockEntry({ business: main.business, location: String(shop._id), product: String(p._id), type: "transfer_in", qty: 5, reference: "TRF-00001", createdBy: user._id });
    await postStockEntry({ business: main.business, location: String(shop._id), product: String(p._id), type: "adjustment", qty: -2, reference: "MANUAL-ADJUSTMENT", notes: "Count 25 Sep", createdBy: user._id });

    const { payload } = await call(listStockMovements, { query: { page: 1, limit: 30 } });
    expect(pageOf(payload)).toMatchObject({ total: 4, pages: 1 });
    const open = payload.data.find((e) => e.type === "opening");
    expect(open.qty).toBe(20);
    expect(open.unitCost).toBe(55);
    expect(open.product).toMatchObject({ name: "Fresh Milk 500ml", sku: "MLK500", unitOfMeasure: "pcs" });
    expect(open.location.name).toBe("Main Store");
    expect(userName(open.createdBy)).toBe("User Test");
    expect(new Date(open.createdAt).getTime()).not.toBeNaN();
    const adj = payload.data.find((e) => e.type === "adjustment");
    expect(adj.qty).toBe(-2);                                                         // the sign is the direction
    expect(adj.notes).toBe("Count 25 Sep");
    expect(payload.data.some((e) => e.quantity !== undefined)).toBe(false);          // the field is `qty`, not `quantity`

    // every chip the screen offers returns rows / an empty list, never an error, and only its own types
    for (const chip of MOVEMENT_FILTERS) {
      const { payload: r } = await call(listStockMovements, { query: { type: chip.key, page: 1, limit: 30 } });
      const wanted = chip.key ? chip.key.split(",") : null;
      if (wanted) expect(r.data.every((e) => wanted.includes(e.type)), chip.label).toBe(true);
    }
    const { payload: transfers } = await call(listStockMovements, { query: { type: "transfer_out,transfer_in" } });
    expect(transfers.data).toHaveLength(2);
    // every server type has a style
    for (const t of ["purchase", "sale", "return", "transfer_out", "transfer_in", "adjustment", "writeoff", "opening"]) {
      expect(MOVEMENT_STYLE[t], t).toBeTruthy();
    }
  });

  it("search matches product name / SKU / reference / notes, every word", async () => {
    const { call, mkProduct, stock, main } = await setup();
    const milk = await mkProduct({ name: "Fresh Milk 500ml", sku: "MLK500" });
    const bread = await mkProduct({ name: "Bread", sku: "BRD1" });
    await stock(milk, main, 10, { reference: "PO-00007" });
    await stock(bread, main, 10, { reference: "OPEN-2", notes: "shelf recount" });
    const ids = async (search) => (await call(listStockMovements, { query: { search } })).payload.data.map((e) => e.product.name);

    expect(await ids("milk")).toEqual(["Fresh Milk 500ml"]);
    expect(await ids("mlk5")).toEqual(["Fresh Milk 500ml"]);
    expect(await ids("PO-0000")).toEqual(["Fresh Milk 500ml"]);
    expect(await ids("recount")).toEqual(["Bread"]);
    expect(await ids("bread open")).toEqual(["Bread"]);
    expect(await ids("nothing like this")).toEqual([]);
  });

  it("adjust form: count correction in / out and a write-off (always out) are accepted and change the balance", async () => {
    const { call, mkProduct, stock, main, business } = await setup();
    const p = await mkProduct({ costPrice: 60 });
    await stock(p, main, 10);
    const base = { location: String(main._id), product: String(p._id) };

    const post = (f) => call(createManualEntry, { body: stockEntryBody({ ...base, ...f }) });

    let r = await post({ type: "adjustment", direction: "in", qty: 5, notes: "Found 5 in the back store" });
    expect(r.statusCode).toBe(201);
    expect(r.payload.newBalance).toBe(15);
    expect(r.payload.data).toMatchObject({ type: "adjustment", qty: 5, notes: "Found 5 in the back store" });

    r = await post({ type: "adjustment", direction: "out", qty: 3, notes: "Count 25 Sep: 3 short" });
    expect(r.payload.newBalance).toBe(12);
    expect(r.payload.data.qty).toBe(-3);

    // a write-off is an outflow whatever direction the form last had
    r = await post({ type: "writeoff", direction: "in", qty: 2, notes: "Expired" });
    expect(r.payload.newBalance).toBe(10);
    expect(r.payload.data).toMatchObject({ type: "writeoff", qty: -2 });
    expect(await getStockBalance(business, main._id, p._id)).toBe(10);

    // the cost defaults to the product's cost (the form does not send one)
    expect(r.payload.data.unitCost).toBe(60);
    // the types offered by the form are the ones the server accepts
    expect([...MANUAL_TYPES].sort()).toEqual(["adjustment", "writeoff"]);
  });

  it("adjust form failure cases: zero qty, unknown location / product, inactive product", async () => {
    const { call, mkProduct, stock, main } = await setup();
    const p = await mkProduct();
    await stock(p, main, 10);
    const base = { location: String(main._id), product: String(p._id), type: "adjustment", direction: "in", notes: "x" };

    await expect(call(createManualEntry, { body: stockEntryBody({ ...base, qty: 0 }) })).rejects.toMatchObject({ status: 400, message: "Qty cannot be zero" });
    await expect(call(createManualEntry, { body: stockEntryBody({ ...base, qty: 1, location: "" }) })).rejects.toMatchObject({ status: 400 });
    await expect(call(createManualEntry, { body: stockEntryBody({ ...base, qty: 1, product: String(new mongoose.Types.ObjectId()) }) })).rejects.toMatchObject({ status: 404 });
    await InvProduct.updateOne({ _id: p._id }, { $set: { active: false } });
    await expect(call(createManualEntry, { body: stockEntryBody({ ...base, qty: 1 }) })).rejects.toMatchObject({ status: 404 });
    expect(await InvStockEntry.countDocuments({ product: p._id })).toBe(1);          // nothing was posted by the failures
  });

  it("stockEntryBody: exactly the keys the server reads, signed qty", () => {
    const b = stockEntryBody({ location: "L", product: "P", type: "adjustment", direction: "out", qty: 4, notes: "  reason  " });
    expect(b).toEqual({ location: "L", product: "P", type: "adjustment", qty: -4, notes: "reason" });
    expect(stockEntryBody({ location: "L", product: "P", type: "writeoff", direction: "in", qty: 4, notes: "n" }).qty).toBe(-4);
    expect(stockEntryBody({ location: "L", product: "P", type: "adjustment", direction: "in", qty: 4, notes: "n" }).qty).toBe(4);
    expect(fmtQty(12)).toBe("12");
    expect(fmtQty(2.5)).toBe("2.5");
    expect(fmtQty(1234.5678)).toBe("1,234.568");
  });
});

// ── Purchase orders (purchase-orders/index.tsx, purchase-orders/[id].tsx) ───────────────────────
describe("mobile contract: purchase orders", () => {
  const makePO = async (ctx, lines, over = {}) => {
    const { payload } = await ctx.call(createPurchaseOrder, {
      body: { supplier: String(ctx.supplier._id), location: String(ctx.main._id), lines, expectedDate: "2026-10-05", notes: "Urgent", ...over },
    });
    return payload.data;
  };

  it("list: rows carry the fields the card reads; every status tab is a real status; search finds the supplier", async () => {
    const ctx = await setup();
    const { call, mkProduct } = ctx;
    const a = await mkProduct({ name: "Fresh Milk 500ml", unitOfMeasure: "pcs" });
    const b = await mkProduct();
    const po = await makePO(ctx, [{ product: String(a._id), qtyOrdered: 10, unitCost: 55 }, { product: String(b._id), qtyOrdered: 4, unitCost: 100 }]);
    const other = await InvSupplier.create({ business: ctx.business, name: "Zed Wholesalers" });
    await makePO({ ...ctx, supplier: other }, [{ product: String(b._id), qtyOrdered: 1, unitCost: 100 }]);

    const { payload } = await call(listPurchaseOrders, { query: { page: 1, limit: 30 } });
    expect(pageOf(payload)).toMatchObject({ total: 2, pages: 1 });
    const row = payload.data.find((r) => r._id.toString() === String(po._id));
    expect(row.poNumber).toMatch(/^PO-/);
    expect(row.supplier.name).toBe("Kamau Traders");
    expect(row.location.name).toBe("Main Store");
    expect(row.status).toBe("draft");
    expect(row.totalAmount).toBe(950);
    expect(new Date(row.orderDate).getTime()).not.toBeNaN();
    expect(new Date(row.expectedDate).getTime()).not.toBeNaN();
    expect(row.lines).toHaveLength(2);
    expect(row.lines.reduce((s, l) => s + l.qtyOrdered, 0)).toBe(14);
    expect(row.lines.every((l) => l.qtyReceived === 0)).toBe(true);
    expect(PO_STATUS[row.status]).toBeTruthy();

    for (const tab of PO_FILTERS) {
      const { statusCode, payload: r } = await call(listPurchaseOrders, { query: { status: tab.key, page: 1, limit: 30 } });
      expect(statusCode).toBe(200);
      if (tab.key) expect(r.data.every((x) => x.status === tab.key), tab.label).toBe(true);
    }

    const names = async (search) => (await call(listPurchaseOrders, { query: { search } })).payload.data.length;
    expect(await names("kamau")).toBe(1);            // supplier name, substring
    expect(await names("zed whole")).toBe(1);        // every word
    expect(await names(po.poNumber)).toBe(1);        // PO number
    expect(await names("PO-")).toBe(2);
    expect(await names("nobody")).toBe(0);
  });

  it("detail: lines with product (name, sku, unitOfMeasure), supplier phone, createdBy name", async () => {
    const ctx = await setup();
    const p = await ctx.mkProduct({ name: "Sugar 1kg", sku: "SUG1", unitOfMeasure: "kg" });
    const po = await makePO(ctx, [{ product: String(p._id), qtyOrdered: 6, unitCost: 150.5 }]);
    const { payload } = await ctx.call(getPurchaseOrder, { params: { id: String(po._id) } });
    const d = payload.data;
    expect(d.poNumber).toBe(po.poNumber);
    expect(d.supplier).toMatchObject({ name: "Kamau Traders", phone: "0712345678" });
    expect(d.location.name).toBe("Main Store");
    expect(d.lines[0]).toMatchObject({ qtyOrdered: 6, qtyReceived: 0, unitCost: 150.5, totalCost: 903 });
    expect(d.lines[0].product).toMatchObject({ name: "Sugar 1kg", sku: "SUG1", unitOfMeasure: "kg" });
    expect(d.lines[0]._id).toBeTruthy();
    expect(d.notes).toBe("Urgent");
    expect(userName(d.createdBy)).toBe("User Test");
    expect(d.receipts).toEqual([]);
    expect(canReceivePO(d.status) && canSendPO(d.status) && canCancelPO(d.status)).toBe(true);

    await expect(ctx.call(getPurchaseOrder, { params: { id: String(new mongoose.Types.ObjectId()) } })).rejects.toMatchObject({ status: 404 });
  });

  it("mark sent (PUT { status: 'sent' }) moves a draft on; a sent PO can be received but not marked sent again", async () => {
    const ctx = await setup();
    const p = await ctx.mkProduct();
    const po = await makePO(ctx, [{ product: String(p._id), qtyOrdered: 2, unitCost: 10 }]);
    const { payload } = await ctx.call(updatePurchaseOrder, { params: { id: String(po._id) }, body: markSentBody() });
    expect(payload.data.status).toBe("sent");
    // the merge did not touch the lines / totals
    const { payload: after } = await ctx.call(getPurchaseOrder, { params: { id: String(po._id) } });
    expect(after.data.lines).toHaveLength(1);
    expect(after.data.totalAmount).toBe(20);
    expect(canSendPO("sent")).toBe(false);
    expect(canReceivePO("sent")).toBe(true);
    expect(canCancelPO("sent")).toBe(true);
  });

  it("receive goods: a partial delivery, then the rest - stock, line quantities, status and product cost follow", async () => {
    const ctx = await setup();
    const { call, main, business } = ctx;
    const a = await ctx.mkProduct({ costPrice: 50 });
    const b = await ctx.mkProduct({ costPrice: 80 });
    const po = await makePO(ctx, [{ product: String(a._id), qtyOrdered: 10, unitCost: 55 }, { product: String(b._id), qtyOrdered: 4, unitCost: 90 }]);
    const [la, lb] = po.lines;

    // the receive form: the user lowers A to 6 and changes B's cost, adds a delivery note
    const first = receiveBody(
      [{ lineId: String(la._id), qty: 6, unitCost: 55 }, { lineId: String(lb._id), qty: 4, unitCost: 95 }],
      " DN-00123 ",
    );
    expect(first).toEqual({ grnRef: "DN-00123", lines: [{ lineId: String(la._id), qtyReceived: 6, unitCost: 55 }, { lineId: String(lb._id), qtyReceived: 4, unitCost: 95 }] });
    let r = await call(receiveGoods, { params: { id: String(po._id) }, body: first });
    expect(r.statusCode).toBe(200);
    expect(r.payload.data.status).toBe("partially_received");
    expect(await getStockBalance(business, main._id, a._id)).toBe(6);
    expect(await getStockBalance(business, main._id, b._id)).toBe(4);
    expect((await InvProduct.findById(b._id)).costPrice).toBe(95);         // receiving sets the product's cost

    const { payload: d1 } = await call(getPurchaseOrder, { params: { id: String(po._id) } });
    expect(d1.data.status).toBe("partially_received");
    expect(d1.data.lines.map((l) => outstanding(l))).toEqual([4, 0]);
    expect(d1.data.receipts).toHaveLength(1);
    expect(d1.data.receipts[0]).toMatchObject({ grnRef: "DN-00123", status: "active" });
    expect(d1.data.receipts[0].lines.reduce((s, l) => s + l.qty, 0)).toBe(10);
    expect(new Date(d1.data.receipts[0].receivedAt).getTime()).not.toBeNaN();

    // second delivery: only the outstanding line is on the form; the fully received line is not sent
    const rest = receiveBody([{ lineId: String(la._id), qty: 4, unitCost: 55 }, { lineId: String(lb._id), qty: 0, unitCost: 95 }]);
    expect(rest.lines).toHaveLength(1);
    expect(rest.grnRef).toBeUndefined();
    r = await call(receiveGoods, { params: { id: String(po._id) }, body: rest });
    expect(r.payload.data.status).toBe("received");
    expect(await getStockBalance(business, main._id, a._id)).toBe(10);
    const { payload: d2 } = await call(getPurchaseOrder, { params: { id: String(po._id) } });
    expect(d2.data.status).toBe("received");
    expect(d2.data.receivedAt).toBeTruthy();
    expect(canReceivePO("received") || canCancelPO("received") || canSendPO("received")).toBe(false);

    // nothing left to receive -> the server refuses instead of recording an empty receipt
    await expect(call(receiveGoods, { params: { id: String(po._id) }, body: rest })).rejects.toMatchObject({ status: 400 });
  });

  it("receive goods failure cases: no lines, zero qty, non-numeric qty, unknown line, cancelled PO - and nothing is posted", async () => {
    const ctx = await setup();
    const { call, main, business } = ctx;
    const a = await ctx.mkProduct();
    const po = await makePO(ctx, [{ product: String(a._id), qtyOrdered: 5, unitCost: 10 }]);
    const lineId = String(po.lines[0]._id);
    const recv = (body) => call(receiveGoods, { params: { id: String(po._id) }, body });

    await expect(recv({ lines: [] })).rejects.toMatchObject({ status: 400 });
    await expect(recv(receiveBody([{ lineId, qty: 0, unitCost: 10 }]))).rejects.toMatchObject({ status: 400 });
    await expect(recv({ lines: [{ lineId, qtyReceived: "abc", unitCost: 10 }] })).rejects.toMatchObject({ status: 400 });
    await expect(recv({ lines: [{ lineId: String(new mongoose.Types.ObjectId()), qtyReceived: 1, unitCost: 10 }] })).rejects.toMatchObject({ status: 400 });
    expect(await getStockBalance(business, main._id, a._id)).toBe(0);
    expect((await InvPurchaseOrder.findById(po._id).lean()).status).toBe("draft");

    // receiving more than is outstanding is clamped by the server (the phone also blocks it)
    const over = await recv(receiveBody([{ lineId, qty: 50, unitCost: 10 }]));
    expect(over.payload.data.status).toBe("received");
    expect(await getStockBalance(business, main._id, a._id)).toBe(5);

    const po2 = await makePO(ctx, [{ product: String(a._id), qtyOrdered: 5, unitCost: 10 }]);
    await call(cancelPurchaseOrder, { params: { id: String(po2._id) } });
    await expect(call(receiveGoods, { params: { id: String(po2._id) }, body: receiveBody([{ lineId: String(po2.lines[0]._id), qty: 1, unitCost: 10 }]) }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("cancel: a draft / sent PO is cancelled; a received or already-cancelled one is refused", async () => {
    const ctx = await setup();
    const { call } = ctx;
    const p = await ctx.mkProduct();
    const line = (n) => [{ product: String(p._id), qtyOrdered: n, unitCost: 10 }];

    const draft = await makePO(ctx, line(1));
    let r = await call(cancelPurchaseOrder, { params: { id: String(draft._id) } });
    expect(r.payload.data.status).toBe("cancelled");
    await expect(call(cancelPurchaseOrder, { params: { id: String(draft._id) } })).rejects.toMatchObject({ status: 400 });

    const done = await makePO(ctx, line(2));
    await call(receiveGoods, { params: { id: String(done._id) }, body: receiveBody([{ lineId: String(done.lines[0]._id), qty: 2, unitCost: 10 }]) });
    await expect(call(cancelPurchaseOrder, { params: { id: String(done._id) } })).rejects.toMatchObject({ status: 400 });
    expect(canCancelPO("cancelled") || canCancelPO("received") || canCancelPO("partially_received")).toBe(false);
  });
});

// ── POS sales (pos-sales/index.tsx) ─────────────────────────────────────────────────────────────
describe("mobile contract: POS sales", () => {
  it("list rows carry payments, customerName, cashier, lines and totals (not paymentBreakdown / customer)", async () => {
    const { call, mkProduct, stock, shop, openSession, sell } = await setup();
    const p = await mkProduct({ name: "Fresh Milk 500ml", sellingPrice: 100, vatRate: 16 });
    await stock(p, shop, 50);
    const session = await openSession();
    const sale = await sell(session, [{ product: String(p._id), qty: 3, discount: 10 }], {
      customerName: "Wanjiku Kamau", customerPhone: "0722111222",
      payments: [{ method: "cash", amount: 100 }, { method: "mpesa", amount: 213.2, ref: "QWE123" }],
    });
    expect(sale.grandTotal).toBe(313.2);   // (100 - 10) * 3 = 270 + 16% VAT

    const { payload } = await call(listSales, { query: { ...dayParams(todayISO()), status: "completed", page: 1, limit: 30 } });
    expect(pageOf(payload)).toMatchObject({ total: 1, pages: 1 });
    const row = payload.data[0];
    expect(row.receiptNumber).toMatch(/^RCP-/);
    expect(row.status).toBe("completed");
    expect(row.payments.map((x) => [x.method, x.amount])).toEqual([["cash", 100], ["mpesa", 213.2]]);
    expect(row.payments[1].ref).toBe("QWE123");
    expect(row.paymentBreakdown).toBeUndefined();
    expect(row.customerName).toBe("Wanjiku Kamau");
    expect(row.customer).toBeUndefined();
    expect(saleCustomer(row)).toBe("Wanjiku Kamau");
    expect(userName(row.cashier)).toBe("User Test");
    expect(row.location.name).toBe("Shop Floor");
    expect(row).toMatchObject({ subtotal: 300, totalDiscount: 30, totalVat: 43.2, grandTotal: 313.2 });
    expect(row.lines[0]).toMatchObject({ productName: "Fresh Milk 500ml", qty: 3, unitPrice: 100, discount: 10, vatRate: 16, lineTotal: 270 });
    expect(row.lines[0]._id).toBeTruthy();
    expect(new Date(row.createdAt).getTime()).not.toBeNaN();
    expect(row.change).toBe(0);
    expect(saleCustomer({ customerName: "", customerPhone: "" })).toBe("Walk-in");
  });

  it("search finds receipt no., customer name and phone; status chips filter", async () => {
    const { call, mkProduct, stock, shop, openSession, sell } = await setup();
    const p = await mkProduct();
    await stock(p, shop, 50);
    const session = await openSession();
    const a = await sell(session, [{ product: String(p._id), qty: 1 }], { customerName: "Wanjiku Kamau", customerPhone: "0722111222" });
    await sell(session, [{ product: String(p._id), qty: 1 }], { customerName: "Otieno" });
    await call(voidSale, { params: { id: String(a._id) }, body: voidBody("wrong item") });

    const q = (o) => call(listSales, { query: { ...dayParams(todayISO()), ...o } }).then((r) => r.payload.data);
    expect((await q({ search: "wanjiku" })).map((s) => s.customerName)).toEqual(["Wanjiku Kamau"]);
    expect((await q({ search: "kam wan" })).map((s) => s.customerName)).toEqual(["Wanjiku Kamau"]);
    expect((await q({ search: "0722111222" })).map((s) => s.customerName)).toEqual(["Wanjiku Kamau"]);
    expect((await q({ search: "+254 722 111 222" })).map((s) => s.customerName)).toEqual(["Wanjiku Kamau"]);
    expect((await q({ search: a.receiptNumber })).map((s) => s._id.toString())).toEqual([String(a._id)]);
    expect(await q({ search: "RCP-" })).toHaveLength(2);
    expect(await q({ search: "nobody" })).toHaveLength(0);

    for (const chip of SALE_FILTERS) {
      const rows = await q({ status: chip.key });
      if (chip.key) expect(rows.every((s) => s.status === chip.key), chip.label).toBe(true);
    }
    expect(await q({ status: "completed" })).toHaveLength(1);
    expect(await q({ status: "voided" })).toHaveLength(1);
    expect(await q({ status: "" })).toHaveLength(2);
  });

  it("void: reason required, stock comes back, the sale drops out of the day summary, a second void is refused", async () => {
    const { call, mkProduct, stock, shop, business, openSession, sell } = await setup();
    const p = await mkProduct({ sellingPrice: 100 });
    await stock(p, shop, 10);
    const session = await openSession();
    const sale = await sell(session, [{ product: String(p._id), qty: 4 }]);
    expect(await getStockBalance(business, shop._id, p._id)).toBe(6);

    await expect(call(voidSale, { params: { id: String(sale._id) }, body: voidBody("   ") })).rejects.toMatchObject({ status: 400, message: "Void reason is required" });
    expect(await getStockBalance(business, shop._id, p._id)).toBe(6);

    const { payload } = await call(voidSale, { params: { id: String(sale._id) }, body: voidBody("  Customer returned items ") });
    expect(payload.data).toMatchObject({ status: "voided", voidReason: "Customer returned items" });
    expect(await getStockBalance(business, shop._id, p._id)).toBe(10);

    const { payload: sum } = await call(salesSummary, { query: dayParams(todayISO()) });
    expect(normalizeSummary(sum.data).count).toBe(0);

    await expect(call(voidSale, { params: { id: String(sale._id) }, body: voidBody("again") })).rejects.toMatchObject({ status: 400 });
    expect(await getStockBalance(business, shop._id, p._id)).toBe(10);

    // the voided row the screen shows: status, voidReason, voidedAt, voidedBy
    const { payload: rows } = await call(listSales, { query: { ...dayParams(todayISO()), status: "voided" } });
    const row = rows.data[0];
    expect(row).toMatchObject({ status: "voided", voidReason: "Customer returned items" });
    expect(row.voidedAt).toBeTruthy();
    expect(userName(row.voidedBy)).toBe("User Test");
  });

  it("voidBody carries exactly voidReason; another company's sale cannot be voided", async () => {
    expect(voidBody("  x ")).toEqual({ voidReason: "x" });
    const a = await setup();
    const b = await setup();
    const p = await b.mkProduct();
    await b.stock(p, b.shop, 5);
    const sale = await b.sell(await b.openSession(), [{ product: String(p._id), qty: 1 }]);
    await expect(a.call(voidSale, { params: { id: String(sale._id) }, body: voidBody("nope") })).rejects.toMatchObject({ status: 404 });
    const { payload } = await a.call(listSales, { query: { ...dayParams(todayISO()) } });
    expect(payload.data).toHaveLength(0);
  });
});

describe("mobile helpers", () => {
  it("shiftDay / dayParams use local calendar arithmetic", () => {
    expect(shiftDay("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    const { from, to } = dayParams("2026-09-25");
    expect(from).toBe(to);
    const d = new Date(from);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 25, 0, 0]);
  });
});
