import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaCheck, FaExchangeAlt, FaPlus, FaRedoAlt, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { useConfirm } from "../../context/ConfirmContext";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import Modal from "../../components/common/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import { inputClass, labelClass } from "../../utils/formStyles";

const STATUSES = ["draft", "in_transit", "partially_received", "received", "cancelled"];

const STATUS_BADGE = {
  draft:              "border-slate-200  bg-slate-50  text-slate-600",
  in_transit:         "border-blue-200   bg-blue-50   text-blue-700",
  partially_received: "border-amber-200  bg-amber-50  text-amber-700",
  received:           "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled:          "border-red-200    bg-red-50    text-red-700",
};

const emptyLine = () => ({ product: "", qtyDispatched: "", unitCost: "" });

const InvStockTransfers = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [statusFilter, setStatusFilter] = useTabState("/inventory/transfers:statusFilter", "");
  const [page, setPage] = useTabState("/inventory/transfers:page", 1);
  const [pageSize, setPageSize] = useTabState("/inventory/transfers:pageSize", 30);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ fromLocation: "", toLocation: "", notes: "", lines: [emptyLine()] });
  const [creating, setCreating] = useState(false);

  const [showReceive, setShowReceive] = useState(false);
  const [selected, setSelected] = useState(null);
  const [receiveLines, setReceiveLines] = useState([]);
  const [receiving, setReceiving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const { data: locations = [] } = useQuery({
    queryKey: ['inv-locations-ref'],
    queryFn: async () => { const d = await inventoryApi.listLocations({ active: true }); return Array.isArray(d) ? d : (d?.data ?? []); },
    staleTime: 5 * 60_000,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['inv-products-ref'],
    queryFn: async () => { const d = await inventoryApi.listProducts({ active: true, limit: 200 }); return Array.isArray(d) ? d : (d?.data ?? []); },
    staleTime: 5 * 60_000,
  });
  const { data: transData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-transfers', statusFilter, page, pageSize],
    queryFn: async () => {
      const res = await inventoryApi.listTransfers({ status: statusFilter || undefined, page, limit: pageSize });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { transfers: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load transfers"); }, [error]);

  const transfers = transData?.transfers ?? [];
  const total = transData?.total ?? 0;
  const pages = Math.ceil(total / pageSize) || 1;

  const addLine = () => setCreateForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx) => setCreateForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  const setLineField = (idx, field, value) =>
    setCreateForm((f) => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }));

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
      queryClient.invalidateQueries({ queryKey: ['inv-transfers'] });
      toast.success("Transfer created as draft");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const handleDispatch = async (t) => {
    const ok = await confirm({ title: "Dispatch Transfer", message: `Dispatch ${t.transferNumber}? This will deduct stock from "${t.fromLocation?.name}".`, confirmText: "Dispatch", isDangerous: false });
    if (!ok) return;
    try {
      await inventoryApi.dispatchTransfer(t._id);
      queryClient.invalidateQueries({ queryKey: ['inv-transfers'] });
      toast.success("Transfer dispatched — stock deducted");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Dispatch failed");
    }
  };

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
      queryClient.invalidateQueries({ queryKey: ['inv-transfers'] });
      toast.success("Transfer received — stock updated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Receive failed");
    } finally {
      setReceiving(false);
    }
  };

  const handleCancel = async (t) => {
    const ok = await confirm({ title: "Cancel Transfer", message: `Cancel transfer ${t.transferNumber}?`, confirmText: "Cancel Transfer", isDangerous: true });
    if (!ok) return;
    try {
      await inventoryApi.cancelTransfer(t._id);
      queryClient.invalidateQueries({ queryKey: ['inv-transfers'] });
      toast.success("Transfer cancelled");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cancel failed");
    }
  };

  const inTransitCount = transfers.filter((t) => t.status === "in_transit").length;

  // Selection
  const allPageIds     = useMemo(() => transfers.map((t) => t._id), [transfers]);
  const cancellableIds = useMemo(() => transfers.filter((t) => ["draft", "in_transit"].includes(t.status)).map((t) => t._id), [transfers]);
  const allSelected    = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected   = allPageIds.some((id) => selectedIds.has(id));
  const selCount       = selectedIds.size;
  const selCancellable = useMemo(() => [...selectedIds].filter((id) => cancellableIds.includes(id)).length, [selectedIds, cancellableIds]);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) allPageIds.forEach((id) => next.delete(id));
      else allPageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allSelected, allPageIds]);

  const toggleOne = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = () => setSelectedIds(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const handleBulkCancel = async () => {
    const ids = [...selectedIds].filter((id) => cancellableIds.includes(id));
    if (!ids.length) { toast.warn("No cancellable transfers selected"); return; }
    const ok = await confirm({ title: "Cancel Transfers", message: `Cancel ${ids.length} transfer(s)?`, confirmText: "Cancel All", isDangerous: true });
    if (!ok) return;
    setBulkWorking(true);
    let failed = 0;
    await Promise.all(ids.map((id) => inventoryApi.cancelTransfer(id).catch(() => { failed++; })));
    if (failed) toast.error(`${failed} transfer(s) could not be cancelled`);
    else toast.success(`${ids.length} transfer(s) cancelled`);
    clearSelection();
    queryClient.invalidateQueries({ queryKey: ['inv-transfers'] });
    setBulkWorking(false);
  };

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Toolbar */}
        {selCount > 0 ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5">
            <span className="text-[11px] font-extrabold text-amber-700">{selCount} selected</span>
            {selCancellable > 0 && (
              <>
                <span className="h-3.5 w-px bg-amber-300" />
                <button type="button" disabled={bulkWorking} onClick={handleBulkCancel}
                  className="inline-flex items-center gap-1 border border-red-300 bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
                  <FaTrash className="text-[9px]" /> Cancel {selCancellable}
                </button>
              </>
            )}
            <button type="button" onClick={clearSelection}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800">
              <FaTimes className="text-[9px]" /> Clear selection
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
            <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} placeholder="All Statuses" clearable size="sm" />
            {inTransitCount > 0 && (
              <span className="text-[11px] font-bold uppercase tracking-wide text-blue-600">
                In Transit: <strong>{inTransitCount}</strong>
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={openCreate} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New Transfer
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[740px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">TRF #</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">From</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">To</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Dispatched</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Received By</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !transfers.length ? (
                <tr>
                  <td colSpan={8} className="px-3 py-14 text-center">
                    <FaExchangeAlt className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">
                      {statusFilter ? "No transfers match this status" : "No stock transfers yet"}
                    </p>
                    {!statusFilter && (
                      <p className="mt-0.5 text-xs text-slate-400">Create a transfer to move stock between locations.</p>
                    )}
                  </td>
                </tr>
              ) : transfers.map((t) => {
                const isSelected = selectedIds.has(t._id);
                return (
                  <tr key={t._id}
                    onClick={() => toggleOne(t._id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                    <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(t._id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 font-mono font-bold text-[#0B3B2E]">
                        <FaExchangeAlt className="shrink-0 text-[10px]" /> {t.transferNumber}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{t.fromLocation?.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{t.toLocation?.name || "—"}</td>
                    <td className="px-3 py-2"><StatusBadge status={t.status} map={STATUS_BADGE} /></td>
                    <td className="px-3 py-2 text-slate-400">{t.dispatchedAt ? new Date(t.dispatchedAt).toLocaleDateString("en-KE") : "—"}</td>
                    <td className="px-3 py-2 text-slate-400">{t.receivedBy?.name || "—"}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
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
                );
              })}
            </tbody>
          </table>
        </div>

        <PaginationBar
          page={page} pages={pages} total={total} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          loading={loading}
        />
      </div>

      {showCreate && (
        <Modal title="New Stock Transfer" onClose={() => setShowCreate(false)} wide footer={
          <>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" form="create-transfer-form" disabled={creating} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
              {creating ? "Creating…" : "Create Transfer"}
            </button>
          </>
        }>
          <form id="create-transfer-form" onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <AppSelect label="From Location" required value={createForm.fromLocation} onChange={(v) => setCreateForm((f) => ({ ...f, fromLocation: v ?? "" }))} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="— Select —" size="md" searchable />
              </div>
              <div>
                <AppSelect label="To Location" required value={createForm.toLocation} onChange={(v) => setCreateForm((f) => ({ ...f, toLocation: v ?? "" }))} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="— Select —" size="md" searchable />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Notes</label>
                <input className={inputClass} value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional reason or reference" />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">Items to Transfer</span>
                <button type="button" onClick={addLine} className="inline-flex items-center gap-1 border border-[#0B3B2E] px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#EDF5F1]">
                  <FaPlus className="text-[9px]" /> Add Item
                </button>
              </div>
              <div className="border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-[#0B3B2E]">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-white">Product</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-white w-24">Qty</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-white w-28">Unit Cost</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {createForm.lines.map((line, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="px-2 py-1.5">
                          <AppSelect required value={line.product} onChange={(v) => setLineField(idx, "product", v ?? "")} options={products.map((p) => ({ value: p._id, label: p.name + (p.sku ? ` · ${p.sku}` : "") }))} placeholder="— Select product —" size="sm" searchable />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" required min="0.001" step="0.001" placeholder="0" value={line.qtyDispatched}
                            onChange={(e) => setLineField(idx, "qtyDispatched", e.target.value)}
                            className="h-8 w-full border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#0B3B2E]" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.01" placeholder="0.00" value={line.unitCost}
                            onChange={(e) => setLineField(idx, "unitCost", e.target.value)}
                            className="h-8 w-full border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#0B3B2E]" />
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

      {showReceive && selected && (
        <Modal title={`Receive Transfer — ${selected.transferNumber}`} onClose={() => setShowReceive(false)} wide footer={
          <>
            <button type="button" onClick={() => setShowReceive(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={handleReceive} disabled={receiving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
              <FaCheck className="text-[9px]" /> {receiving ? "Posting…" : "Confirm Receipt"}
            </button>
          </>
        }>
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            From: <strong>{selected.fromLocation?.name}</strong> → To: <strong>{selected.toLocation?.name}</strong>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0B3B2E]">
                {["Product", "SKU", "Dispatched", "Received", "Pending", "Receiving Now"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-white">{h}</th>
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
                      className="h-8 w-24 border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#0B3B2E]" />
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
