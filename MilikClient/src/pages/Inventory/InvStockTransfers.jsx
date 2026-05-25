import React, { useCallback, useEffect, useState } from "react";
import { FaCheck, FaExchangeAlt, FaPlus, FaRedoAlt, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";

const STATUSES = ["draft", "in_transit", "partially_received", "received", "cancelled"];

const STATUS_BADGE = {
  draft:              "border-slate-200  bg-slate-50  text-slate-600",
  in_transit:         "border-blue-200   bg-blue-50   text-blue-700",
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

const emptyLine = () => ({ product: "", qtyDispatched: "", unitCost: "" });

const Modal = ({ title, onClose, children, footer, wide }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className={`w-full border border-slate-200 bg-white shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#1a5c3a] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="max-h-[78vh] overflow-y-auto p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const InvStockTransfers = () => {
  const [transfers, setTransfers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ fromLocation: "", toLocation: "", notes: "", lines: [emptyLine()] });
  const [creating, setCreating] = useState(false);

  // Receive modal
  const [showReceive, setShowReceive] = useState(false);
  const [selected, setSelected] = useState(null);
  const [receiveLines, setReceiveLines] = useState([]);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, locs, prods] = await Promise.all([
        inventoryApi.listTransfers({ status: statusFilter || undefined, page, limit: 30 }),
        locations.length ? Promise.resolve(locations) : inventoryApi.listLocations({ active: true }),
        products.length ? Promise.resolve(products) : inventoryApi.listProducts({ active: true, limit: 200 }),
      ]);
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setTransfers(list);
      setTotal(res?.total ?? list.length);
      if (Array.isArray(locs)) setLocations(locs);
      else if (Array.isArray(locs?.data)) setLocations(locs.data);
      const pl = Array.isArray(prods) ? prods : (prods?.data ?? []);
      if (pl.length) setProducts(pl);
    } catch {
      toast.error("Failed to load transfers");
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  // ── Line helpers ──────────────────────────────────────────────────────────
  const addLine = () => setCreateForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx) => setCreateForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  const setLineField = (idx, field, value) =>
    setCreateForm((f) => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }));

  // ── Create ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setCreateForm({ fromLocation: "", toLocation: "", notes: "", lines: [emptyLine()] });
    setShowCreate(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (createForm.fromLocation === createForm.toLocation) {
      toast.error("From and To locations must be different");
      return;
    }
    if (!createForm.lines.every((l) => l.product && Number(l.qtyDispatched) > 0)) {
      toast.error("All lines need a product and a positive quantity");
      return;
    }
    setCreating(true);
    try {
      await inventoryApi.createTransfer({
        fromLocation: createForm.fromLocation,
        toLocation: createForm.toLocation,
        notes: createForm.notes,
        lines: createForm.lines.map((l) => ({
          product: l.product,
          qtyDispatched: Number(l.qtyDispatched),
          unitCost: Number(l.unitCost || 0),
        })),
      });
      setShowCreate(false);
      await load();
      toast.success("Transfer created as draft");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  // ── Dispatch ──────────────────────────────────────────────────────────────
  const handleDispatch = async (t) => {
    if (!window.confirm(`Dispatch transfer ${t.transferNumber}?\nThis will deduct stock from "${t.fromLocation?.name}".`)) return;
    try {
      await inventoryApi.dispatchTransfer(t._id);
      await load();
      toast.success("Transfer dispatched — stock deducted");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Dispatch failed");
    }
  };

  // ── Receive ───────────────────────────────────────────────────────────────
  const openReceive = async (t) => {
    try {
      const detail = await inventoryApi.getTransfer(t._id);
      setSelected(detail);
      setReceiveLines(detail.lines.map((l) => ({
        lineId: l._id,
        productName: l.product?.name || "",
        sku: l.product?.sku || "",
        qtyDispatched: l.qtyDispatched,
        qtyReceived: l.qtyReceived,
        pending: l.qtyDispatched - l.qtyReceived,
        toReceive: l.qtyDispatched - l.qtyReceived,
      })));
      setShowReceive(true);
    } catch {
      toast.error("Failed to load transfer details");
    }
  };

  const handleReceive = async () => {
    setReceiving(true);
    try {
      await inventoryApi.receiveTransfer(selected._id, {
        lines: receiveLines.map((l) => ({ lineId: l.lineId, qtyReceived: Number(l.toReceive || 0) })),
      });
      setShowReceive(false);
      await load();
      toast.success("Transfer received — stock updated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Receive failed");
    } finally {
      setReceiving(false);
    }
  };

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = async (t) => {
    if (!window.confirm(`Cancel transfer ${t.transferNumber}?`)) return;
    try {
      await inventoryApi.cancelTransfer(t._id);
      await load();
      toast.success("Transfer cancelled");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cancel failed");
    }
  };

  const inTransitCount = transfers.filter((t) => t.status === "in_transit").length;

  return (
    <InventoryShell
      title="Stock Transfers"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#1a5c3a] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#1a5c3a] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#154d30]">
            <FaPlus /> New Transfer
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
          {inTransitCount > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-wide text-blue-600">
              In Transit: <strong>{inTransitCount}</strong>
            </span>
          )}
          <div className="ml-auto">
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#1a5c3a]">
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        </div>

        <table className="w-full min-w-[700px] text-xs">
          <thead className="bg-[#1a5c3a] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">TRF #</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">From</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">To</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Dispatched</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Received By</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !transfers.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-14 text-center">
                  <FaExchangeAlt className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {statusFilter ? "No transfers match this status" : "No stock transfers yet"}
                  </p>
                  {!statusFilter && (
                    <p className="mt-0.5 text-xs text-slate-400">Create a transfer to move stock between locations.</p>
                  )}
                </td>
              </tr>
            ) : transfers.map((t) => (
              <tr key={t._id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 font-mono font-bold text-[#1a5c3a]">
                    <FaExchangeAlt className="shrink-0 text-[10px]" /> {t.transferNumber}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">{t.fromLocation?.name || "—"}</td>
                <td className="px-3 py-2 text-slate-700">{t.toLocation?.name || "—"}</td>
                <td className="px-3 py-2"><StatusPill status={t.status} /></td>
                <td className="px-3 py-2 text-slate-400">{t.dispatchedAt ? new Date(t.dispatchedAt).toLocaleDateString("en-KE") : "—"}</td>
                <td className="px-3 py-2 text-slate-400">{t.receivedBy?.name || "—"}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {t.status === "draft" && (
                      <button type="button" onClick={() => handleDispatch(t)} className="inline-flex items-center gap-1 border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-bold text-blue-600 hover:bg-blue-50">
                        Dispatch
                      </button>
                    )}
                    {["in_transit", "partially_received"].includes(t.status) && (
                      <button type="button" onClick={() => openReceive(t)} className="inline-flex items-center gap-1 border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50">
                        <FaCheck className="text-[9px]" /> Receive
                      </button>
                    )}
                    {["draft", "in_transit"].includes(t.status) && (
                      <button type="button" onClick={() => handleCancel(t)} className="inline-flex items-center gap-1 border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
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
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={transfers.length < 30} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#1a5c3a]">Next →</button>
          </div>
        )}
      </div>

      {/* ── Create Transfer Modal ─────────────────────────────────────────── */}
      {showCreate && (
        <Modal title="New Stock Transfer" onClose={() => setShowCreate(false)} wide footer={
          <>
            <button type="button" onClick={() => setShowCreate(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
            <button type="submit" form="create-transfer-form" disabled={creating} className="bg-[#1a5c3a] px-4 py-2 text-xs font-bold text-white hover:bg-[#154d30] disabled:opacity-50">
              {creating ? "Creating…" : "Create Transfer"}
            </button>
          </>
        }>
          <form id="create-transfer-form" onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>From Location *</label>
                <select required className={inputClass} value={createForm.fromLocation} onChange={(e) => setCreateForm((f) => ({ ...f, fromLocation: e.target.value }))}>
                  <option value="">— Select —</option>
                  {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>To Location *</label>
                <select required className={inputClass} value={createForm.toLocation} onChange={(e) => setCreateForm((f) => ({ ...f, toLocation: e.target.value }))}>
                  <option value="">— Select —</option>
                  {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Notes</label>
                <input className={inputClass} value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional reason or reference" />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#1a5c3a]">Items to Transfer</span>
                <button type="button" onClick={addLine} className="inline-flex items-center gap-1 border border-[#1a5c3a] px-2 py-0.5 text-[11px] font-bold text-[#1a5c3a] hover:bg-[#EDF5F1]">
                  <FaPlus className="text-[9px]" /> Add Item
                </button>
              </div>
              <div className="border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Product</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-500 w-24">Qty</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-500 w-28">Unit Cost</th>
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
                          <input type="number" required min="0.001" step="0.001" placeholder="0" value={line.qtyDispatched}
                            onChange={(e) => setLineField(idx, "qtyDispatched", e.target.value)}
                            className="h-8 w-full border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#1a5c3a]" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.01" placeholder="0.00" value={line.unitCost}
                            onChange={(e) => setLineField(idx, "unitCost", e.target.value)}
                            className="h-8 w-full border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#1a5c3a]" />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {createForm.lines.length > 1 && (
                            <button type="button" onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600">
                              <FaTrash className="text-[10px]" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Receive Transfer Modal ────────────────────────────────────────── */}
      {showReceive && selected && (
        <Modal title={`Receive Transfer — ${selected.transferNumber}`} onClose={() => setShowReceive(false)} wide footer={
          <>
            <button type="button" onClick={() => setShowReceive(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
            <button type="button" onClick={handleReceive} disabled={receiving} className="inline-flex items-center gap-1.5 bg-[#1a5c3a] px-4 py-2 text-xs font-bold text-white hover:bg-[#154d30] disabled:opacity-50">
              <FaCheck className="text-[9px]" /> {receiving ? "Posting…" : "Confirm Receipt"}
            </button>
          </>
        }>
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            From: <strong>{selected.fromLocation?.name}</strong> → To: <strong>{selected.toLocation?.name}</strong>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {["Product", "SKU", "Dispatched", "Received", "Pending", "Receiving Now"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {receiveLines.map((line, idx) => (
                <tr key={line.lineId} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-semibold text-slate-800">{line.productName}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-400">{line.sku || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{line.qtyDispatched}</td>
                  <td className="px-2 py-1.5 font-bold text-emerald-600">{line.qtyReceived}</td>
                  <td className="px-2 py-1.5 font-bold text-amber-600">{line.pending}</td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" max={line.pending} step="0.001" value={line.toReceive}
                      onChange={(e) => setReceiveLines((prev) => prev.map((l, i) => i === idx ? { ...l, toReceive: e.target.value } : l))}
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

export default InvStockTransfers;
