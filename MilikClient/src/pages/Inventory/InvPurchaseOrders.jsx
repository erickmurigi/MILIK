import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaCheck, FaFileInvoice, FaLock, FaMoneyBillWave, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { useConfirm } from "../../context/ConfirmContext";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney, todayISO } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";

const STATUSES = ["draft", "sent", "partially_received", "received", "cancelled"];

const STATUS_BADGE = {
  draft:              "border-slate-200  bg-slate-50  text-slate-600",
  sent:               "border-blue-200   bg-blue-50   text-blue-700",
  partially_received: "border-amber-200  bg-amber-50  text-amber-700",
  received:           "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled:          "border-red-200    bg-red-50    text-red-700",
};
const PAYMENT_BADGE = {
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  voided:    "border-red-200    bg-red-50    text-red-700",
};

const StatusPill = ({ status, map = STATUS_BADGE }) => (
  <span className={`inline-flex border px-2 py-0.5 text-[9px] font-bold uppercase ${map[status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>
    {String(status || "").replace(/_/g, " ")}
  </span>
);

const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

const emptyLine = () => ({ product: "", qtyOrdered: "", unitCost: "", costAutoFilled: false });

const Modal = ({ title, onClose, children, footer, wide }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className={`w-full border border-slate-200 bg-white shadow-2xl ${wide ? "max-w-3xl" : "max-w-xl"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="max-h-[78vh] overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const InvPurchaseOrders = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [statusFilter, setStatusFilter] = useTabState("/inventory/purchase-orders:statusFilter", "");
  const [search, setSearch] = useTabState("/inventory/purchase-orders:search", "");
  const [page, setPage] = useTabState("/inventory/purchase-orders:page", 1);
  const [pageSize, setPageSize] = useTabState("/inventory/purchase-orders:pageSize", 30);

  // ── Create PO state ─────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ supplier: "", location: "", expectedDate: "", notes: "", lines: [emptyLine()] });
  const [creating, setCreating] = useState(false);

  // ── Receive goods state ──────────────────────────────────────────────────────
  const [showReceive, setShowReceive] = useState(false);
  const [selected, setSelected] = useState(null);
  const [receiveLines, setReceiveLines] = useState([]);
  const [receiveGrnRef, setReceiveGrnRef] = useState("");
  const [receiving, setReceiving] = useState(false);

  // ── Receipt history & cancel state ───────────────────────────────────────────
  const [showReceipts, setShowReceipts] = useState(false);
  const [receiptsForPO, setReceiptsForPO] = useState(null);
  const [cancellingReceiptId, setCancellingReceiptId] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellingReceipt, setCancellingReceipt] = useState(false);
  const [cancellingAllReceiving, setCancellingAllReceiving] = useState(false);

  // ── Pay supplier state ───────────────────────────────────────────────────────
  const [showPaySupplier, setShowPaySupplier] = useState(false);
  const [payPO, setPayPO] = useState(null);
  const [paymentsForPO, setPaymentsForPO] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", cashbookAccountId: "", paymentDate: todayISO(), reference: "", notes: "" });
  const [paying, setPaying] = useState(false);
  const [voidingPaymentId, setVoidingPaymentId] = useState(null);

  // ── Selection state ──────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: suppliers = [] } = useQuery({
    queryKey: ['inv-suppliers-ref'],
    queryFn: async () => { const d = await inventoryApi.listSuppliers({ active: true, limit: 200 }); return Array.isArray(d) ? d : (d?.data ?? []); },
    staleTime: 5 * 60_000,
  });
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
  const { data: cashbookAccounts = [] } = useQuery({
    queryKey: ['inv-cashbook-accounts'],
    queryFn: () => inventoryApi.listCashbookAccounts(),
    staleTime: 10 * 60_000,
    enabled: showPaySupplier,
  });
  const { data: poData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-purchase-orders', statusFilter, search, page, pageSize],
    queryFn: async () => {
      const res = await inventoryApi.listPurchaseOrders({ status: statusFilter || undefined, search: search || undefined, page, limit: pageSize });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { orders: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load purchase orders"); }, [error]);

  const orders = poData?.orders ?? [];
  const total  = poData?.total  ?? 0;
  const pages  = Math.ceil(total / pageSize) || 1;

  // ── Create PO helpers ────────────────────────────────────────────────────────
  const addLine    = () => setCreateForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx) => setCreateForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  const setLineField = (idx, field, value) =>
    setCreateForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => {
        if (i !== idx) return l;
        if (field === "product") {
          const prod = products.find((p) => p._id === value);
          return { ...l, product: value ?? "", unitCost: prod?.costPrice ?? "", costAutoFilled: !!prod?.costPrice };
        }
        if (field === "unitCost") return { ...l, unitCost: value, costAutoFilled: false };
        return { ...l, [field]: value };
      }),
    }));

  const lineTotal  = (line) => { const q = Number(line.qtyOrdered || 0), c = Number(line.unitCost || 0); return q && c ? q * c : 0; };
  const grandTotal = createForm.lines.reduce((s, l) => s + lineTotal(l), 0);

  const openCreate = () => {
    setCreateForm({ supplier: "", location: "", expectedDate: "", notes: "", lines: [emptyLine()] });
    setShowCreate(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.lines.every((l) => l.product && Number(l.qtyOrdered) > 0)) {
      toast.error("All lines need a product and a positive quantity"); return;
    }
    setCreating(true);
    try {
      await inventoryApi.createPurchaseOrder({
        supplier: createForm.supplier, location: createForm.location,
        expectedDate: createForm.expectedDate || undefined, notes: createForm.notes,
        lines: createForm.lines.map((l) => ({ product: l.product, qtyOrdered: Number(l.qtyOrdered), unitCost: Number(l.unitCost || 0) })),
      });
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ['inv-purchase-orders'] });
      toast.success("Purchase order created");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  // ── Receive goods helpers ────────────────────────────────────────────────────
  const openReceive = async (po) => {
    try {
      const detail = await inventoryApi.getPurchaseOrder(po._id);
      setSelected(detail);
      setReceiveGrnRef("");
      setReceiveLines(detail.lines.map((l) => ({
        lineId: l._id, productName: l.product?.name || "", sku: l.product?.sku || "",
        qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived,
        pending: l.qtyOrdered - l.qtyReceived,
        toReceive: l.qtyOrdered - l.qtyReceived,
        unitCost: l.unitCost,
      })));
      setShowReceive(true);
    } catch { toast.error("Failed to load PO details"); }
  };

  const handleReceive = async () => {
    setReceiving(true);
    try {
      await inventoryApi.receiveGoods(selected._id, {
        grnRef: receiveGrnRef,
        lines: receiveLines.map((l) => ({ lineId: l.lineId, qtyReceived: Number(l.toReceive || 0), unitCost: Number(l.unitCost || 0) })),
      });
      setShowReceive(false);
      queryClient.invalidateQueries({ queryKey: ['inv-purchase-orders'] });
      toast.success("Goods received and stock updated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Receive failed");
    } finally {
      setReceiving(false);
    }
  };

  // ── Receipt history & cancel helpers ─────────────────────────────────────────
  const openReceipts = async (po) => {
    try {
      const detail = await inventoryApi.getPurchaseOrder(po._id);
      setReceiptsForPO(detail);
      setCancellingReceiptId(null);
      setCancelReason("");
      setShowReceipts(true);
    } catch { toast.error("Failed to load receipts"); }
  };

  const handleCancelReceipt = async (receiptId) => {
    setCancellingReceipt(true);
    try {
      const updated = await inventoryApi.cancelReceipt(receiptsForPO._id, receiptId, { cancelReason });
      setReceiptsForPO(updated);
      setCancellingReceiptId(null);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ['inv-purchase-orders'] });
      toast.success("Receipt cancelled and stock reversed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cancel failed");
    } finally {
      setCancellingReceipt(false);
    }
  };

  const handleCancelAllReceiving = async () => {
    const ok = await confirm({
      title: "Cancel All Receiving",
      message: `Reverse ALL stock received on ${receiptsForPO.poNumber}? This will post negative stock adjustments and reverse the GL entries. The PO will go back to "Sent" status.`,
      confirmText: "Cancel All Receiving",
      isDangerous: true,
    });
    if (!ok) return;
    setCancellingAllReceiving(true);
    try {
      const updated = await inventoryApi.cancelAllReceiving(receiptsForPO._id);
      setReceiptsForPO(updated);
      queryClient.invalidateQueries({ queryKey: ['inv-purchase-orders'] });
      toast.success("All receiving cancelled — stock and GL reversed");
      setShowReceipts(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cancel failed");
    } finally {
      setCancellingAllReceiving(false);
    }
  };

  // ── Pay supplier helpers ─────────────────────────────────────────────────────
  const openPaySupplier = async (po) => {
    setPayPO(po);
    setPaymentsForPO([]);
    setPayForm({ amount: "", cashbookAccountId: "", paymentDate: todayISO(), reference: "", notes: "" });
    setShowPaySupplier(true);
    setLoadingPayments(true);
    try {
      const pmts = await inventoryApi.listSupplierPayments({ purchaseOrder: po._id });
      const list = Array.isArray(pmts) ? pmts : (pmts?.data ?? []);
      setPaymentsForPO(list);
      // Pre-fill outstanding amount
      const totalReceived = (po.receipts ?? []).filter((r) => r.status === "active")
        .reduce((s, r) => s + r.lines.reduce((ls, l) => ls + Number(l.qty) * Number(l.unitCost), 0), 0);
      const totalPaid = list.filter((p) => p.status === "confirmed").reduce((s, p) => s + Number(p.amount), 0);
      const outstanding = Math.max(0, Math.round((totalReceived - totalPaid) * 100) / 100);
      if (outstanding > 0) setPayForm((f) => ({ ...f, amount: String(outstanding) }));
    } catch { setPaymentsForPO([]); }
    finally { setLoadingPayments(false); }
  };

  const handlePaySupplier = async (e) => {
    e.preventDefault();
    if (!payForm.amount || Number(payForm.amount) <= 0) { toast.error("Amount must be positive"); return; }
    if (!payForm.cashbookAccountId) { toast.error("Select a cashbook account"); return; }
    setPaying(true);
    try {
      await inventoryApi.createSupplierPayment({
        supplier:          payPO.supplier?._id || payPO.supplier,
        purchaseOrder:     payPO._id,
        amount:            Number(payForm.amount),
        cashbookAccountId: payForm.cashbookAccountId,
        paymentDate:       payForm.paymentDate,
        reference:         payForm.reference,
        notes:             payForm.notes,
      });
      const pmts = await inventoryApi.listSupplierPayments({ purchaseOrder: payPO._id });
      setPaymentsForPO(Array.isArray(pmts) ? pmts : (pmts?.data ?? []));
      setPayForm((f) => ({ ...f, amount: "", reference: "", notes: "" }));
      queryClient.invalidateQueries({ queryKey: ['inv-purchase-orders'] });
      toast.success("Payment recorded — GL posted (Dr AP / Cr Cashbook)");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  const handleVoidPayment = async (paymentId) => {
    const ok = await confirm({ title: "Void Payment", message: "Void this payment? The GL entries will be reversed.", confirmText: "Void", isDangerous: true });
    if (!ok) return;
    setVoidingPaymentId(paymentId);
    try {
      await inventoryApi.voidSupplierPayment(paymentId);
      const pmts = await inventoryApi.listSupplierPayments({ purchaseOrder: payPO._id });
      setPaymentsForPO(Array.isArray(pmts) ? pmts : (pmts?.data ?? []));
      toast.success("Payment voided");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Void failed");
    } finally {
      setVoidingPaymentId(null);
    }
  };

  // ── PO cancel helpers ────────────────────────────────────────────────────────
  const handleCancel = async (po) => {
    const ok = await confirm({ title: "Cancel Purchase Order", message: `Cancel PO ${po.poNumber}? This cannot be undone.`, confirmText: "Cancel PO", isDangerous: true });
    if (!ok) return;
    try {
      await inventoryApi.cancelPurchaseOrder(po._id);
      queryClient.invalidateQueries({ queryKey: ['inv-purchase-orders'] });
      toast.success("Purchase order cancelled");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cancel failed");
    }
  };

  // ── Selection helpers ────────────────────────────────────────────────────────
  const openCount     = orders.filter((o) => ["draft", "sent"].includes(o.status)).length;
  const pendingCount  = orders.filter((o) => o.status === "partially_received").length;
  const allPageIds    = useMemo(() => orders.map((o) => o._id), [orders]);
  const cancellableIds= useMemo(() => orders.filter((o) => ["draft", "sent"].includes(o.status)).map((o) => o._id), [orders]);
  const allSelected   = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected  = allPageIds.some((id) => selectedIds.has(id));
  const selCount      = selectedIds.size;
  const selCancellable= useMemo(() => [...selectedIds].filter((id) => cancellableIds.includes(id)).length, [selectedIds, cancellableIds]);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) allPageIds.forEach((id) => next.delete(id));
      else allPageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allSelected, allPageIds]);

  const toggleOne = useCallback((id) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkCancel = async () => {
    const ids = [...selectedIds].filter((id) => cancellableIds.includes(id));
    if (!ids.length) { toast.warn("No cancellable POs selected"); return; }
    const ok = await confirm({ title: "Cancel Purchase Orders", message: `Cancel ${ids.length} purchase order(s)?`, confirmText: "Cancel All", isDangerous: true });
    if (!ok) return;
    setBulkWorking(true);
    let failed = 0;
    await Promise.all(ids.map((id) => inventoryApi.cancelPurchaseOrder(id).catch(() => { failed++; })));
    if (failed) toast.error(`${failed} PO(s) could not be cancelled`);
    else toast.success(`${ids.length} purchase order(s) cancelled`);
    clearSelection();
    queryClient.invalidateQueries({ queryKey: ['inv-purchase-orders'] });
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
            <div className="flex h-7 items-center gap-1.5 border border-slate-300 bg-white px-2 text-xs focus-within:border-[#0B3B2E]">
              <FaSearch className="shrink-0 text-[10px] text-slate-400" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="PO number…"
                className="w-28 bg-transparent text-slate-700 placeholder-slate-400 outline-none" />
              {search && <button type="button" onClick={() => { setSearch(""); setPage(1); }} className="text-slate-400 hover:text-slate-600"><FaTimes className="text-[9px]" /></button>}
            </div>
            {openCount > 0 && <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Open: <strong className="text-[#0B3B2E]">{openCount}</strong></span>}
            {pendingCount > 0 && <span className="text-[11px] font-bold uppercase tracking-wide text-amber-600">Partial: <strong>{pendingCount}</strong></span>}
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
<button type="button" onClick={openCreate} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New PO
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">PO #</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Supplier</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Location</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Total</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Order Date</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !orders.length ? (
                <tr>
                  <td colSpan={8} className="px-3 py-14 text-center">
                    <FaFileInvoice className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">
                      {statusFilter || search ? "No purchase orders match your filters" : "No purchase orders yet"}
                    </p>
                    {!statusFilter && !search && (
                      <p className="mt-0.5 text-xs text-slate-400">Create a purchase order to start receiving stock from suppliers.</p>
                    )}
                  </td>
                </tr>
              ) : orders.map((po) => {
                const isSelected = selectedIds.has(po._id);
                // receipts array isn't in the list response — infer from status
                const hasReceipts = ["partially_received", "received"].includes(po.status);
                return (
                  <tr key={po._id}
                    onClick={() => toggleOne(po._id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                    <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(po._id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 font-mono font-bold text-[#0B3B2E]">
                        <FaFileInvoice className="shrink-0" /> {po.poNumber}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{po.supplier?.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{po.location?.name || "—"}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800">{formatMoney(po.totalAmount)}</td>
                    <td className="px-3 py-2"><StatusPill status={po.status} /></td>
                    <td className="px-3 py-2 text-slate-400">{po.orderDate ? new Date(po.orderDate).toLocaleDateString("en-KE") : "—"}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {["draft", "sent", "partially_received"].includes(po.status) && (
                          <button type="button" onClick={() => openReceive(po)}
                            className="inline-flex items-center gap-1 border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50">
                            <FaCheck className="text-[9px]" /> Receive
                          </button>
                        )}
                        {hasReceipts && (
                          <button type="button" onClick={() => openReceipts(po)}
                            className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                            Receipts
                          </button>
                        )}
                        {hasReceipts && (
                          <button type="button" onClick={() => openPaySupplier(po)}
                            className="inline-flex items-center gap-1 border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-50">
                            <FaMoneyBillWave className="text-[9px]" /> Pay
                          </button>
                        )}
                        {["draft", "sent"].includes(po.status) && (
                          <button type="button" onClick={() => handleCancel(po)}
                            className="inline-flex items-center gap-1 border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
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

        <PaginationBar page={page} pages={pages} total={total} pageSize={pageSize}
          onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={loading} />
      </div>

      {/* ── Create PO Modal ─────────────────────────────────────────────────────── */}
      {showCreate && (
        <Modal title="New Purchase Order" onClose={() => setShowCreate(false)} wide footer={
          <>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" form="create-po-form" disabled={creating} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
              {creating ? "Creating…" : "Create Purchase Order"}
            </button>
          </>
        }>
          <form id="create-po-form" onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><AppSelect label="Supplier" required value={createForm.supplier} onChange={(v) => setCreateForm((f) => ({ ...f, supplier: v ?? "" }))} options={suppliers.map((s) => ({ value: s._id, label: s.name }))} placeholder="— Select Supplier —" size="md" searchable /></div>
              <div><AppSelect label="Receiving Location" required value={createForm.location} onChange={(v) => setCreateForm((f) => ({ ...f, location: v ?? "" }))} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="— Select Location —" size="md" searchable /></div>
              <div>
                <label className={labelClass}>Expected Delivery Date</label>
                <input type="date" className={inputClass} value={createForm.expectedDate} onChange={(e) => setCreateForm((f) => ({ ...f, expectedDate: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>Notes / Reference</label>
                <input className={inputClass} value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">Order Lines</span>
                <button type="button" onClick={addLine} className="inline-flex items-center gap-1 border border-[#0B3B2E] px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#EDF5F1]">
                  <FaPlus className="text-[9px]" /> Add Line
                </button>
              </div>
              <div className="border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-[#0B3B2E]">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-white">Product</th>
                      <th className="w-24 px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-white">Qty</th>
                      <th className="w-32 px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-white">Unit Cost</th>
                      <th className="w-28 px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-white">Line Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {createForm.lines.map((line, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="px-2 py-1.5">
                          <AppSelect required value={line.product}
                            onChange={(v) => setLineField(idx, "product", v ?? "")}
                            options={products.map((p) => ({ value: p._id, label: p.name + (p.sku ? ` · ${p.sku}` : "") }))}
                            placeholder="— Select product —" size="sm" searchable />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" required min="0.001" step="0.001" placeholder="0" value={line.qtyOrdered}
                            onChange={(e) => setLineField(idx, "qtyOrdered", e.target.value)}
                            className="h-8 w-full border border-slate-300 px-1.5 text-right text-xs text-slate-800 outline-none focus:border-[#0B3B2E]" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <input type="number" min="0" step="0.01" placeholder="0.00" value={line.unitCost}
                              onChange={(e) => setLineField(idx, "unitCost", e.target.value)}
                              className={`h-8 w-full border px-1.5 pr-6 text-right text-xs text-slate-800 outline-none focus:border-[#0B3B2E] ${line.costAutoFilled ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-white"}`} />
                            {line.costAutoFilled && (
                              <FaLock className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-emerald-500" title="Auto-filled from product cost price" />
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold text-slate-700">{formatMoney(lineTotal(line))}</td>
                        <td className="px-2 py-1.5 text-center">
                          {createForm.lines.length > 1 && (
                            <button type="button" onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600"><FaTrash className="text-[10px]" /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50">
                      <td colSpan={3} className="px-2 py-1.5 text-right text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Grand Total</td>
                      <td className="px-2 py-1.5 text-right text-sm font-extrabold text-[#0B3B2E]">{formatMoney(grandTotal)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Receive Goods Modal ──────────────────────────────────────────────────── */}
      {showReceive && selected && (
        <Modal title={`Receive Goods — ${selected.poNumber}`} onClose={() => setShowReceive(false)} wide footer={
          <>
            <button type="button" onClick={() => setShowReceive(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={handleReceive} disabled={receiving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
              <FaCheck className="text-[9px]" />{receiving ? "Posting…" : "Confirm Receipt"}
            </button>
          </>
        }>
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Supplier: <strong>{selected.supplier?.name}</strong> · Location: <strong>{selected.location?.name}</strong>
          </div>
          <div className="mb-3">
            <label className={labelClass}>Delivery Note / GRN Reference</label>
            <input className={inputClass} value={receiveGrnRef} onChange={(e) => setReceiveGrnRef(e.target.value)} placeholder="e.g. DN-00123 (optional)" />
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0B3B2E]">
                {["Product", "SKU", "Ordered", "Received", "Pending", "Receiving Now", "Unit Cost"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-white">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {receiveLines.map((line, idx) => (
                <tr key={line.lineId} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-semibold text-slate-800">{line.productName}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-400">{line.sku || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{line.qtyOrdered}</td>
                  <td className="px-2 py-1.5 font-bold text-emerald-600">{line.qtyReceived}</td>
                  <td className="px-2 py-1.5 font-bold text-amber-600">{line.pending}</td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" max={line.pending} step="0.001" value={line.toReceive}
                      onChange={(e) => {
                        const val = Math.min(Number(e.target.value), line.pending);
                        if (Number(e.target.value) > line.pending) toast.warn(`Max receivable: ${line.pending}`);
                        setReceiveLines((prev) => prev.map((l, i) => i === idx ? { ...l, toReceive: val } : l));
                      }}
                      className="h-8 w-20 border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#0B3B2E]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="0.01" value={line.unitCost}
                      onChange={(e) => setReceiveLines((prev) => prev.map((l, i) => i === idx ? { ...l, unitCost: e.target.value } : l))}
                      className="h-8 w-24 border border-slate-300 px-1.5 text-right text-xs outline-none focus:border-[#0B3B2E]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {/* ── Receipt History Modal ────────────────────────────────────────────────── */}
      {showReceipts && receiptsForPO && (
        <Modal title={`Receipts — ${receiptsForPO.poNumber}`} onClose={() => setShowReceipts(false)} wide>
          <div className="mb-3 flex items-center justify-between gap-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <span>Supplier: <strong>{receiptsForPO.supplier?.name}</strong> · Location: <strong>{receiptsForPO.location?.name}</strong> · Status: <strong className="uppercase">{receiptsForPO.status?.replace(/_/g, " ")}</strong></span>
            {["received", "partially_received"].includes(receiptsForPO.status) && (receiptsForPO.receipts?.length > 0) && (
              <button type="button" disabled={cancellingAllReceiving} onClick={handleCancelAllReceiving}
                className="shrink-0 border border-red-300 bg-red-600 px-3 py-1 text-[10px] font-black text-white hover:bg-red-700 disabled:opacity-50">
                {cancellingAllReceiving ? "Reversing…" : "Cancel ALL Receiving"}
              </button>
            )}
          </div>
          {!receiptsForPO.receipts?.length ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-4 py-5 text-center">
              <p className="mb-1 text-sm font-bold text-amber-800">No receipt records found</p>
              <p className="mb-4 text-xs text-amber-700">
                This PO was received before receipt tracking was introduced. You can still reverse all received stock below.
              </p>
              <button type="button" disabled={cancellingAllReceiving} onClick={handleCancelAllReceiving}
                className="inline-flex items-center gap-1.5 border border-red-300 bg-red-600 px-4 py-2 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50">
                <FaTimes /> {cancellingAllReceiving ? "Reversing…" : "Cancel All Receiving"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {receiptsForPO.receipts.map((r) => (
                <div key={r._id} className={`rounded border ${r.status === "cancelled" ? "border-red-200 bg-red-50/40" : "border-emerald-200 bg-emerald-50/30"}`}>
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                    <div className="flex items-center gap-3">
                      <StatusPill status={r.status} map={{ active: "border-emerald-200 bg-emerald-50 text-emerald-700", cancelled: "border-red-200 bg-red-50 text-red-700" }} />
                      <span className="text-[11px] text-slate-600">
                        {new Date(r.receivedAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                      {r.grnRef && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">GRN: {r.grnRef}</span>}
                    </div>
                    {r.status === "active" && (
                      cancellingReceiptId === r._id ? (
                        <div className="flex items-center gap-2">
                          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Cancel reason…"
                            className="h-7 w-48 border border-slate-300 px-2 text-[11px] outline-none focus:border-red-400" />
                          <button type="button" disabled={cancellingReceipt || !cancelReason.trim()}
                            onClick={() => handleCancelReceipt(r._id)}
                            className="h-7 border border-red-300 bg-red-600 px-2 text-[10px] font-bold text-white hover:bg-red-700 disabled:opacity-50">
                            {cancellingReceipt ? "…" : "Confirm"}
                          </button>
                          <button type="button" onClick={() => { setCancellingReceiptId(null); setCancelReason(""); }}
                            className="h-7 border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 hover:bg-slate-50">
                            Back
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setCancellingReceiptId(r._id); setCancelReason(""); }}
                          className="inline-flex items-center gap-1 border border-red-200 bg-white px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-50">
                          Cancel Receipt
                        </button>
                      )
                    )}
                    {r.status === "cancelled" && r.cancelReason && (
                      <span className="text-[10px] italic text-red-500">Reason: {r.cancelReason}</span>
                    )}
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        {["Product", "Qty", "Unit Cost", "Line Total"].map((h) => (
                          <th key={h} className="px-3 py-1 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.lines.map((rl) => (
                        <tr key={rl._id} className="border-t border-slate-100">
                          <td className="px-3 py-1 text-slate-700">{rl.product?.name || "—"}</td>
                          <td className="px-3 py-1 font-bold text-slate-800">{rl.qty}</td>
                          <td className="px-3 py-1 text-slate-600">{formatMoney(rl.unitCost)}</td>
                          <td className="px-3 py-1 font-bold text-[#0B3B2E]">{formatMoney(Number(rl.qty) * Number(rl.unitCost))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50">
                        <td colSpan={3} className="px-3 py-1 text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Receipt Total</td>
                        <td className="px-3 py-1 font-extrabold text-[#0B3B2E]">
                          {formatMoney(r.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitCost), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* ── Pay Supplier Modal ───────────────────────────────────────────────────── */}
      {showPaySupplier && payPO && (
        <Modal title={`Pay Supplier — ${payPO.poNumber}`} onClose={() => setShowPaySupplier(false)} wide>
          {/* Summary bar */}
          {(() => {
            const totalReceived = (payPO.receipts ?? []).filter((r) => r.status === "active")
              .reduce((s, r) => s + r.lines.reduce((ls, l) => ls + Number(l.qty) * Number(l.unitCost), 0), 0);
            const totalPaid = paymentsForPO.filter((p) => p.status === "confirmed").reduce((s, p) => s + Number(p.amount), 0);
            const outstanding = Math.max(0, totalReceived - totalPaid);
            return (
              <div className="mb-4 grid grid-cols-3 divide-x divide-slate-200 rounded border border-slate-200 bg-[#EDF5F1]">
                {[["Goods Received", formatMoney(totalReceived)], ["Paid So Far", formatMoney(totalPaid)], ["Outstanding AP", formatMoney(outstanding)]].map(([label, val]) => (
                  <div key={label} className="px-4 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="text-sm font-extrabold text-[#0B3B2E]">{val}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Payment history */}
          {loadingPayments ? (
            <p className="py-4 text-center text-xs text-slate-400">Loading payment history…</p>
          ) : paymentsForPO.length > 0 && (
            <div className="mb-4">
              <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-widest text-slate-500">Payment History</p>
              <table className="w-full text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    {["Ref #", "Date", "Amount", "Account", "Status", ""].map((h) => (
                      <th key={h} className="px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paymentsForPO.map((p) => (
                    <tr key={p._id} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-mono text-[#0B3B2E]">{p.paymentNumber}</td>
                      <td className="px-2 py-1 text-slate-500">{new Date(p.paymentDate).toLocaleDateString("en-KE")}</td>
                      <td className="px-2 py-1 font-bold text-slate-800">{formatMoney(p.amount)}</td>
                      <td className="px-2 py-1 text-slate-500">{p.cashbookAccountId?.name || p.cashbookAccountName || "—"}</td>
                      <td className="px-2 py-1"><StatusPill status={p.status} map={PAYMENT_BADGE} /></td>
                      <td className="px-2 py-1 text-right">
                        {p.status === "confirmed" && (
                          <button type="button" disabled={voidingPaymentId === p._id}
                            onClick={() => handleVoidPayment(p._id)}
                            className="border border-red-200 px-1.5 py-0.5 text-[9px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-40">
                            {voidingPaymentId === p._id ? "…" : "Void"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* New payment form */}
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">Record New Payment</p>
            <form id="pay-supplier-form" onSubmit={handlePaySupplier} className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Amount *</label>
                <input type="number" required min="0.01" step="0.01" placeholder="0.00"
                  value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Payment Date *</label>
                <input type="date" required value={payForm.paymentDate}
                  onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  className={inputClass} />
              </div>
              <div className="col-span-2">
                <AppSelect
                  label="Cashbook Account *"
                  required
                  value={payForm.cashbookAccountId}
                  onChange={(v) => setPayForm((f) => ({ ...f, cashbookAccountId: v ?? "" }))}
                  options={(cashbookAccounts ?? []).map((a) => ({ value: a._id, label: `${a.code} — ${a.name}` }))}
                  placeholder="— Select account to pay from —"
                  size="md"
                  searchable
                />
              </div>
              <div>
                <label className={labelClass}>Reference</label>
                <input placeholder="Cheque / M-Pesa / EFT ref" value={payForm.reference}
                  onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <input placeholder="Optional" value={payForm.notes}
                  onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputClass} />
              </div>
              <div className="col-span-2 flex justify-end">
                <button type="submit" disabled={paying}
                  className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-5 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                  <FaMoneyBillWave className="text-[10px]" />
                  {paying ? "Posting…" : "Record Payment"}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvPurchaseOrders;
