import React, { useCallback, useEffect, useState } from "react";
import { FaCheck, FaFileInvoice, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";

const STATUSES = ["draft", "sent", "partially_received", "received", "cancelled"];

const STATUS_BADGE = {
  draft:              "border-slate-200  bg-slate-50  text-slate-600",
  sent:               "border-blue-200   bg-blue-50   text-blue-700",
  partially_received: "border-amber-200  bg-amber-50  text-amber-700",
  received:           "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled:          "border-red-200    bg-red-50    text-red-700",
};

const StatusPill = ({ status }) => (
  <span className={`inline-flex border px-2 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>
    {String(status || "").replace(/_/g, " ")}
  </span>
);

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#1a5c3a] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const emptyLine = () => ({ product: "", qtyOrdered: "", unitCost: "" });

const Modal = ({ title, onClose, children, footer, wide }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className={`w-full border border-slate-200 bg-white shadow-2xl ${wide ? "max-w-3xl" : "max-w-xl"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#1a5c3a] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="max-h-[78vh] overflow-y-auto p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const InvPurchaseOrders = () => {
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ supplier: "", location: "", expectedDate: "", notes: "", lines: [emptyLine()] });
  const [creating, setCreating] = useState(false);

  // Receive modal
  const [showReceive, setShowReceive] = useState(false);
  const [selected, setSelected] = useState(null);
  const [receiveLines, setReceiveLines] = useState([]);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, sups, locs, prods] = await Promise.all([
        inventoryApi.listPurchaseOrders({ status: statusFilter || undefined, search: search || undefined, page, limit: 30 }),
        suppliers.length ? Promise.resolve(suppliers) : inventoryApi.listSuppliers({ active: true, limit: 200 }),
        locations.length ? Promise.resolve(locations) : inventoryApi.listLocations({ active: true }),
        products.length ? Promise.resolve(products) : inventoryApi.listProducts({ active: true, limit: 200 }),
      ]);
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setOrders(list);
      setTotal(res?.total ?? list.length);
      if (Array.isArray(sups)) setSuppliers(sups);
      else if (Array.isArray(sups?.data)) setSuppliers(sups.data);
      if (Array.isArray(locs)) setLocations(locs);
      else if (Array.isArray(locs?.data)) setLocations(locs.data);
      const pl = Array.isArray(prods) ? prods : (prods?.data ?? []);
      if (pl.length) setProducts(pl);
    } catch {
      toast.error("Failed to load purchase orders");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, page]);

  useEffect(() => { load(); }, [load]);

  // ── Line helpers ──────────────────────────────────────────────────────────
  const addLine = () => setCreateForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx) => setCreateForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  const setLineField = (idx, field, value) =>
    setCreateForm((f) => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }));

  const lineTotal = (line) => {
    const q = Number(line.qtyOrdered || 0);
    const c = Number(line.unitCost || 0);
    return q && c ? q * c : 0;
  };
  const grandTotal = createForm.lines.reduce((s, l) => s + lineTotal(l), 0);

  // ── Create PO ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setCreateForm({ supplier: "", location: "", expectedDate: "", notes: "", lines: [emptyLine()] });
    setShowCreate(true);
  };
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.lines.every((l) => l.product && Number(l.qtyOrdered) > 0)) {
      toast.error("All lines need a product and a positive quantity");
      return;
    }
    setCreating(true);
    try {
      await inventoryApi.createPurchaseOrder({
        supplier: createForm.supplier,
        location: createForm.location,
        expectedDate: createForm.expectedDate || undefined,
        notes: createForm.notes,
        lines: createForm.lines.map((l) => ({
          product: l.product,
          qtyOrdered: Number(l.qtyOrdered),
          unitCost: Number(l.unitCost || 0),
        })),
      });
      setShowCreate(false);
      await load();
      toast.success("Purchase order created");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  // ── Receive goods ─────────────────────────────────────────────────────────
  const openReceive = async (po) => {
    try {
      const detail = await inventoryApi.getPurchaseOrder(po._id);
      setSelected(detail);
      setReceiveLines(
        detail.lines.map((l) => ({
          lineId: l._id,
          productName: l.product?.name || "",
          sku: l.product?.sku || "",
          qtyOrdered: l.qtyOrdered,
          qtyReceived: l.qtyReceived,
          pending: l.qtyOrdered - l.qtyReceived,
          toReceive: l.qtyOrdered - l.qtyReceived,
          unitCost: l.unitCost,
        }))
      );
      setShowReceive(true);
    } catch {
      toast.error("Failed to load PO details");
    }
  };

  const handleReceive = async () => {
    setReceiving(true);
    try {
      await inventoryApi.receiveGoods(selected._id, {
        lines: receiveLines.map((l) => ({
          lineId: l.lineId,
          qtyReceived: Number(l.toReceive || 0),
          unitCost: Number(l.unitCost || 0),
        })),
      });
      setShowReceive(false);
      await load();
      toast.success("Goods received and stock updated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Receive failed");
    } finally {
      setReceiving(false);
    }
  };

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = async (po) => {
    if (!window.confirm(`Cancel PO ${po.poNumber}? This cannot be undone.`)) return;
    try {
      await inventoryApi.cancelPurchaseOrder(po._id);
      await load();
      toast.success("Purchase order cancelled");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cancel failed");
    }
  };

  const openCount   = orders.filter((o) => ["draft", "sent"].includes(o.status)).length;
  const pendingCount = orders.filter((o) => o.status === "partially_received").length;

  return (
    <InventoryShell
      title="Purchase Orders"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#1a5c3a] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#1a5c3a] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#154d30]">
            <FaPlus /> New PO
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Summary + filter strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Total: <strong className="text-[#1a5c3a]">{total}</strong>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Open: <strong className="text-[#1a5c3a]">{openCount}</strong>
          </span>
          {pendingCount > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-wide text-amber-600">
              Partial: <strong>{pendingCount}</strong>
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#1a5c3a]">
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
            <div className="flex items-center gap-1.5 border border-slate-300 bg-white px-2 py-1 text-xs">
              <FaSearch className="text-slate-400 text-[10px]" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="PO number…"
                className="w-32 bg-transparent outline-none text-slate-700 placeholder-slate-400" />
            </div>
          </div>
        </div>

        <table className="w-full min-w-[700px] text-xs">
          <thead className="bg-[#1a5c3a] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">PO #</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Supplier</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Location</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Total</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Order Date</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !orders.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-14 text-center">
                  <FaFileInvoice className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {statusFilter || search ? "No purchase orders match your filters" : "No purchase orders yet"}
                  </p>
                  {!statusFilter && !search && (
                    <p className="mt-0.5 text-xs text-slate-400">Create a purchase order to start receiving stock from suppliers.</p>
                  )}
                </td>
              </tr>
            ) : orders.map((po) => (
              <tr key={po._id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 font-mono font-bold text-[#1a5c3a]">
                    <FaFileInvoice className="shrink-0" /> {po.poNumber}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">{po.supplier?.name || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{po.location?.name || "—"}</td>
                <td className="px-3 py-2 text-right font-bold text-slate-800">{formatMoney(po.totalAmount)}</td>
                <td className="px-3 py-2"><StatusPill status={po.status} /></td>
                <td className="px-3 py-2 text-slate-400">{po.orderDate ? new Date(po.orderDate).toLocaleDateString("en-KE") : "—"}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {["draft", "sent", "partially_received"].includes(po.status) && (
                      <button type="button" onClick={() => openReceive(po)} className="inline-flex items-center gap-1 border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50">
                        <FaCheck className="text-[9px]" /> Receive
                      </button>
                    )}
                    {["draft", "sent"].includes(po.status) && (
                      <button type="button" onClick={() => handleCancel(po)} className="inline-flex items-center gap-1 border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
                        Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > 30 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#1a5c3a]">← Previous</button>
            <span className="text-xs text-slate-500">Page {page} of {Math.ceil(total / 30)}</span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={orders.length < 30} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#1a5c3a]">Next →</button>
          </div>
        )}
      </div>

      {/* ── Create PO Modal ───────────────────────────────────────────────── */}
      {showCreate && (
        <Modal title="New Purchase Order" onClose={() => setShowCreate(false)} wide footer={
          <>
            <button type="button" onClick={() => setShowCreate(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
            <button type="submit" form="create-po-form" disabled={creating} className="bg-[#1a5c3a] px-4 py-2 text-xs font-bold text-white hover:bg-[#154d30] disabled:opacity-50">
              {creating ? "Creating…" : "Create Purchase Order"}
            </button>
          </>
        }>
          <form id="create-po-form" onSubmit={handleCreate} className="space-y-4">
            {/* Header fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Supplier *</label>
                <select required className={inputClass} value={createForm.supplier} onChange={(e) => setCreateForm((f) => ({ ...f, supplier: e.target.value }))}>
                  <option value="">— Select Supplier —</option>
                  {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Receiving Location *</label>
                <select required className={inputClass} value={createForm.location} onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}>
                  <option value="">— Select Location —</option>
                  {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Expected Delivery Date</label>
                <input type="date" className={inputClass} value={createForm.expectedDate} onChange={(e) => setCreateForm((f) => ({ ...f, expectedDate: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>Notes / Reference</label>
                <input className={inputClass} value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#1a5c3a]">Order Lines</span>
                <button type="button" onClick={addLine} className="inline-flex items-center gap-1 border border-[#1a5c3a] px-2 py-0.5 text-[11px] font-bold text-[#1a5c3a] hover:bg-[#EDF5F1]">
                  <FaPlus className="text-[9px]" /> Add Line
                </button>
              </div>

              <div className="border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Product</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-500 w-24">Qty</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-500 w-28">Unit Cost</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-500 w-28">Line Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {createForm.lines.map((line, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="px-2 py-1.5">
                          <select required value={line.product} onChange={(e) => setLineField(idx, "product", e.target.value)}
                            className="h-8 w-full border border-slate-300 px-1.5 text-xs text-slate-800 outline-none focus:border-[#1a5c3a]">
                            <option value="">— Select product —</option>
                            {products.map((p) => <option key={p._id} value={p._id}>{p.name}{p.sku ? ` · ${p.sku}` : ""}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" required min="0.001" step="0.001" placeholder="0" value={line.qtyOrdered}
                            onChange={(e) => setLineField(idx, "qtyOrdered", e.target.value)}
                            className="h-8 w-full border border-slate-300 px-1.5 text-right text-xs text-slate-800 outline-none focus:border-[#1a5c3a]" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.01" placeholder="0.00" value={line.unitCost}
                            onChange={(e) => setLineField(idx, "unitCost", e.target.value)}
                            className="h-8 w-full border border-slate-300 px-1.5 text-right text-xs text-slate-800 outline-none focus:border-[#1a5c3a]" />
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold text-slate-700">{formatMoney(lineTotal(line))}</td>
                        <td className="px-2 py-1.5 text-center">
                          {createForm.lines.length > 1 && (
                            <button type="button" onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600">
                              <FaTrash className="text-[10px]" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50">
                      <td colSpan={3} className="px-2 py-1.5 text-right text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Grand Total</td>
                      <td className="px-2 py-1.5 text-right text-sm font-extrabold text-[#1a5c3a]">{formatMoney(grandTotal)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Receive Goods Modal ───────────────────────────────────────────── */}
      {showReceive && selected && (
        <Modal title={`Receive Goods — ${selected.poNumber}`} onClose={() => setShowReceive(false)} wide footer={
          <>
            <button type="button" onClick={() => setShowReceive(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
            <button type="button" onClick={handleReceive} disabled={receiving} className="inline-flex items-center gap-1.5 bg-[#1a5c3a] px-4 py-2 text-xs font-bold text-white hover:bg-[#154d30] disabled:opacity-50">
              <FaCheck className="text-[9px]" />{receiving ? "Posting…" : "Confirm Receipt"}
            </button>
          </>
        }>
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Supplier: <strong>{selected.supplier?.name}</strong> · Location: <strong>{selected.location?.name}</strong>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {["Product", "SKU", "Ordered", "Already Received", "Pending", "Receiving Now", "Unit Cost"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {receiveLines.map((line, idx) => (
                <tr key={line.lineId} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-semibold text-slate-800">{line.productName}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-400">{line.sku || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{line.qtyOrdered}</td>
                  <td className="px-2 py-1.5 text-emerald-600 font-bold">{line.qtyReceived}</td>
                  <td className="px-2 py-1.5 font-bold text-amber-600">{line.pending}</td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" max={line.pending} step="0.001" value={line.toReceive}
                      onChange={(e) => setReceiveLines((prev) => prev.map((l, i) => i === idx ? { ...l, toReceive: e.target.value } : l))}
                      className="h-8 w-20 border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#1a5c3a]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="0.01" value={line.unitCost}
                      onChange={(e) => setReceiveLines((prev) => prev.map((l, i) => i === idx ? { ...l, unitCost: e.target.value } : l))}
                      className="h-8 w-24 border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#1a5c3a]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvPurchaseOrders;
