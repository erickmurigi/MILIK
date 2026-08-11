import React, { useMemo, useEffect, useState, useCallback } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FaArrowDown, FaArrowUp, FaBarcode, FaBoxOpen, FaChartLine, FaCheck,
  FaEdit, FaFileImport, FaFilter, FaPlus, FaRedoAlt, FaSearch, FaTimes,
  FaToggleOff, FaToggleOn, FaTrash,
} from "react-icons/fa";
import ProductsImportModal from "../../components/Modals/ProductsImportModal";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import Modal from "../../components/common/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import { inputClass, labelClass } from "../../utils/formStyles";

const UOM_OPTIONS = ["pcs", "units", "kg", "g", "ltr", "ml", "m", "cm", "box", "pack", "dozen", "bag", "roll", "sheet", "pair", "set"];
const VAT_OPTIONS = [{ label: "0% (Exempt)", value: "0" }, { label: "8% (Reduced)", value: "8" }, { label: "16% (Standard)", value: "16" }];

const emptyForm = () => ({
  name: "", sku: "", barcode: "", category: "", unitOfMeasure: "pcs",
  costPrice: "", sellingPrice: "", vatRate: "16",
  trackStock: true, serialized: false,
  reorderLevel: "0", description: "",
});

const SectionHead = ({ children }) => (
  <div className="col-span-2 border-b border-slate-100 pb-1 pt-1">
    <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">{children}</span>
  </div>
);

const TYPE_LABELS = {
  purchase: "Purchase", sale: "Sale", return: "Return",
  transfer_out: "Transfer Out", transfer_in: "Transfer In",
  adjustment: "Adjustment", writeoff: "Write-off", opening: "Opening",
};

const STOCK_CARD_LIMIT = 50;

const StockCardModal = ({ product, onClose }) => {
  const [scPage, setScPage] = useState(1);

  const { data: scData, isLoading } = useQuery({
    queryKey: ["inv-stock-card", product._id, scPage],
    queryFn: async () => {
      const res = await inventoryApi.listMovements({ product: product._id, limit: STOCK_CARD_LIMIT, page: scPage });
      return { data: Array.isArray(res) ? res : (res?.data ?? []), total: res?.total ?? 0 };
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const rawMovements = scData?.data ?? [];
  const scTotal = scData?.total ?? 0;

  const { rows, totalIn, totalOut, closingBalance } = useMemo(() => {
    const asc = [...rawMovements].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    let running = 0, totalIn = 0, totalOut = 0;
    const enriched = asc.map((e) => {
      running += Number(e.qty);
      if (Number(e.qty) > 0) totalIn += Number(e.qty);
      else totalOut += Math.abs(Number(e.qty));
      return { ...e, runningBalance: running };
    });
    return { rows: enriched.reverse(), totalIn, totalOut, closingBalance: running };
  }, [rawMovements]);

  return (
    <Modal title={`Stock Card — ${product.name}`} onClose={onClose} wide>
      {/* Summary bar */}
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-700">Total In</div>
          <div className="text-xl font-extrabold text-emerald-700">{totalIn} <span className="text-xs font-normal">{product.unitOfMeasure}</span></div>
        </div>
        <div className="border border-red-200 bg-red-50 px-3 py-2">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-red-700">Total Out</div>
          <div className="text-xl font-extrabold text-red-700">{totalOut} <span className="text-xs font-normal">{product.unitOfMeasure}</span></div>
        </div>
        <div className="border border-[#0B3B2E] bg-[#EDF5F1] px-3 py-2">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">Balance</div>
          <div className={`text-xl font-extrabold ${closingBalance < 0 ? "text-red-600" : "text-[#0B3B2E]"}`}>{closingBalance} <span className="text-xs font-normal">{product.unitOfMeasure}</span></div>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead className="bg-[#0B3B2E] text-white">
          <tr>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Location</th>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Reference</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">In</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Out</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Balance</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Loading movements…</td></tr>
          ) : !rows.length ? (
            <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">No movements found for this product.</td></tr>
          ) : rows.map((e) => {
            const qty = Number(e.qty);
            return (
              <tr key={e._id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleDateString("en-KE", { dateStyle: "short" })}
                </td>
                <td className="px-2 py-1.5 text-slate-700">{TYPE_LABELS[e.type] || e.type}</td>
                <td className="px-2 py-1.5 text-slate-600">{e.location?.name || "—"}</td>
                <td className="px-2 py-1.5 font-mono text-[10px] text-slate-400">{e.reference || "—"}</td>
                <td className="px-2 py-1.5 text-right font-bold text-emerald-600">
                  {qty > 0 ? <span className="inline-flex items-center gap-0.5"><FaArrowUp className="text-[9px]" />{qty}</span> : "—"}
                </td>
                <td className="px-2 py-1.5 text-right font-bold text-red-600">
                  {qty < 0 ? <span className="inline-flex items-center gap-0.5"><FaArrowDown className="text-[9px]" />{Math.abs(qty)}</span> : "—"}
                </td>
                <td className={`px-2 py-1.5 text-right font-extrabold ${e.runningBalance < 0 ? "text-red-600" : "text-[#0B3B2E]"}`}>
                  {e.runningBalance}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {scTotal > STOCK_CARD_LIMIT && (
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
          <button type="button" onClick={() => setScPage((p) => Math.max(1, p - 1))} disabled={scPage === 1} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#0B3B2E]">← Newer</button>
          <span className="text-xs text-slate-500">Page {scPage} of {Math.ceil(scTotal / STOCK_CARD_LIMIT)}</span>
          <button type="button" onClick={() => setScPage((p) => p + 1)} disabled={rawMovements.length < STOCK_CARD_LIMIT} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#0B3B2E]">Older →</button>
        </div>
      )}
    </Modal>
  );
};

const PillFilter = ({ label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1 border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide transition-all ${
      active
        ? "border-[#0B3B2E] bg-[#0B3B2E] text-white"
        : "border-slate-300 bg-white text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
    }`}
  >
    {active && <FaCheck className="text-[8px]" />} {label}
  </button>
);

const ConfirmModal = ({ title, message, onConfirm, onCancel, danger }) => (
  <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px]">
    <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
      <div className={`flex items-center gap-3 border-b px-4 py-3 ${danger ? "border-red-200 bg-red-700" : "border-slate-200 bg-[#0B3B2E]"}`}>
        <span className="text-sm font-extrabold uppercase tracking-wide text-white">{title}</span>
      </div>
      <div className="px-4 py-4 text-sm text-slate-700">{message}</div>
      <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
        <button type="button" onClick={onCancel} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
        <button type="button" onClick={onConfirm} className={`px-4 py-1.5 text-xs font-black text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-[#0B3B2E] hover:bg-[#0A3127]"}`}>Confirm</button>
      </div>
    </div>
  </div>
);

const InvProducts = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useTabState("/inventory/products:search", "");
  const [categoryFilter, setCategoryFilter] = useTabState("/inventory/products:categoryFilter", "");
  const [statusFilter, setStatusFilter] = useTabState("/inventory/products:statusFilter", "");   // "" | "active" | "inactive"
  const [trackFilter, setTrackFilter] = useTabState("/inventory/products:trackFilter", "");      // "" | "tracked" | "untracked"
  const [vatFilter, setVatFilter] = useTabState("/inventory/products:vatFilter", "");            // "" | "0" | "8" | "16"
  const [page, setPage] = useTabState("/inventory/products:page", 1);
  const [pageSize, setPageSize] = useTabState("/inventory/products:pageSize", 50);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [stockCardProduct, setStockCardProduct] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // null | "single:<id>" | "bulk"
  const [bulkWorking, setBulkWorking] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['inv-categories-ref'],
    queryFn: async () => {
      const data = await inventoryApi.listCategories({ active: true });
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    staleTime: 5 * 60_000,
  });

  const { data: prodData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-products', search, categoryFilter, statusFilter, trackFilter, vatFilter, page, pageSize],
    queryFn: async () => {
      const params = { search, page, limit: pageSize };
      if (categoryFilter) params.category = categoryFilter;
      if (statusFilter === "active")    params.active = true;
      if (statusFilter === "inactive")  params.active = false;
      if (trackFilter === "tracked")    params.trackStock = true;
      if (trackFilter === "untracked")  params.trackStock = false;
      const res = await inventoryApi.listProducts(params);
      let list = Array.isArray(res) ? res : (res?.data ?? []);
      // VAT filter applied client-side (not a backend param) only if set
      if (vatFilter !== "") list = list.filter((p) => String(p.vatRate) === vatFilter);
      return { products: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load products"); }, [error]);

  const products = prodData?.products ?? [];
  const total    = prodData?.total ?? 0;
  const pages    = Math.max(1, Math.ceil(total / pageSize));

  // Selection helpers
  const allPageIds = useMemo(() => products.map((p) => p._id), [products]);
  const allSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected = allPageIds.some((id) => selectedIds.has(id));

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

  // Bulk actions
  const handleBulkActivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateProduct(id, { active: true })));
      toast.success(`${selectedIds.size} product(s) activated`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['inv-products'] });
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  const handleBulkDeactivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateProduct(id, { active: false })));
      toast.success(`${selectedIds.size} product(s) deactivated`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['inv-products'] });
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  const handleBulkDelete = async () => {
    setBulkWorking(true);
    let failed = 0;
    await Promise.all(
      [...selectedIds].map((id) => inventoryApi.deleteProduct(id).catch(() => { failed++; }))
    );
    if (failed) toast.error(`${failed} product(s) could not be deleted (has stock movements)`);
    else toast.success(`${selectedIds.size} product(s) deleted`);
    clearSelection();
    setConfirmDelete(null);
    queryClient.invalidateQueries({ queryKey: ['inv-products'] });
    setBulkWorking(false);
  };

  const handleSingleDelete = async (id) => {
    try {
      await inventoryApi.deleteProduct(id);
      toast.success("Product deleted");
      queryClient.invalidateQueries({ queryKey: ['inv-products'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Delete failed");
    }
    setConfirmDelete(null);
  };

  const handleImport = async (rows) => {
    const result = await inventoryApi.bulkImportProducts(rows);
    queryClient.invalidateQueries({ queryKey: ['inv-products'] });
    queryClient.invalidateQueries({ queryKey: ['inv-products-ref'] });
    return result;
  };

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku || "", barcode: p.barcode || "",
      category: p.category?._id || p.category || "",
      unitOfMeasure: p.unitOfMeasure || "pcs",
      costPrice: String(p.costPrice ?? ""), sellingPrice: String(p.sellingPrice ?? ""),
      vatRate: String(p.vatRate ?? "16"),
      trackStock: p.trackStock !== false,
      serialized: p.serialized === true,
      reorderLevel: String(p.reorderLevel ?? "0"),
      description: p.description || "",
    });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        costPrice: Number(form.costPrice || 0),
        sellingPrice: Number(form.sellingPrice || 0),
        vatRate: Number(form.vatRate || 0),
        reorderLevel: Number(form.reorderLevel || 0),
        category: form.category || undefined,
        serialized: form.trackStock ? form.serialized : false,
      };
      if (editing) await inventoryApi.updateProduct(editing._id, payload);
      else await inventoryApi.createProduct(payload);
      closeModal();
      queryClient.invalidateQueries({ queryKey: ['inv-products'] });
      queryClient.invalidateQueries({ queryKey: ['inv-products-ref'] });
      toast.success(`Product ${editing ? "updated" : "created"} successfully`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p) => {
    try {
      await inventoryApi.updateProduct(p._id, { active: !p.active });
      queryClient.invalidateQueries({ queryKey: ['inv-products'] });
      queryClient.invalidateQueries({ queryKey: ['inv-products-ref'] });
      toast.success(`Product ${p.active ? "deactivated" : "activated"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Update failed");
    }
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const setCheck = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.checked }));

  const hasFilters = !!(search || categoryFilter || statusFilter || trackFilter || vatFilter);
  const selCount     = selectedIds.size;

  const resetFilters = () => {
    setSearch(""); setCategoryFilter(""); setStatusFilter("");
    setTrackFilter(""); setVatFilter(""); setPage(1);
  };

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">

        {/* ── Single toolbar: bulk OR filters+actions ────────────────── */}
        {selCount > 0 ? (
          /* Bulk action bar */
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5">
            <span className="text-[11px] font-extrabold text-amber-700">{selCount} selected</span>
            <span className="h-3.5 w-px bg-amber-300" />
            <button type="button" disabled={bulkWorking} onClick={handleBulkActivate}
              className="inline-flex items-center gap-1 border border-emerald-300 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              <FaToggleOn /> Activate
            </button>
            <button type="button" disabled={bulkWorking} onClick={handleBulkDeactivate}
              className="inline-flex items-center gap-1 border border-orange-300 bg-white px-2.5 py-1 text-[10px] font-bold text-orange-700 hover:bg-orange-50 disabled:opacity-50">
              <FaToggleOff /> Deactivate
            </button>
            <button type="button" disabled={bulkWorking} onClick={() => setConfirmDelete("bulk")}
              className="inline-flex items-center gap-1 border border-red-300 bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
              <FaTrash className="text-[9px]" /> Delete
            </button>
            <button type="button" onClick={clearSelection}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800">
              <FaTimes className="text-[9px]" /> Clear selection
            </button>
          </div>
        ) : (
          /* ── Filter + action strip (single row) ──────────────────── */
          <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">

            {/* Status pills */}
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Status:</span>
            <PillFilter label="Active"   active={statusFilter === "active"}   onClick={() => { setStatusFilter(statusFilter === "active"   ? "" : "active");   setPage(1); }} />
            <PillFilter label="Inactive" active={statusFilter === "inactive"} onClick={() => { setStatusFilter(statusFilter === "inactive" ? "" : "inactive"); setPage(1); }} />
            <span className="mx-1 h-3.5 w-px bg-slate-300" />

            {/* Stock pills */}
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Stock:</span>
            <PillFilter label="Tracked"   active={trackFilter === "tracked"}   onClick={() => { setTrackFilter(trackFilter === "tracked"   ? "" : "tracked");   setPage(1); }} />
            <PillFilter label="Untracked" active={trackFilter === "untracked"} onClick={() => { setTrackFilter(trackFilter === "untracked" ? "" : "untracked"); setPage(1); }} />
            <span className="mx-1 h-3.5 w-px bg-slate-300" />

            {/* VAT pills */}
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">VAT:</span>
            <PillFilter label="0%"  active={vatFilter === "0"}  onClick={() => { setVatFilter(vatFilter === "0"  ? "" : "0");  setPage(1); }} />
            <PillFilter label="8%"  active={vatFilter === "8"}  onClick={() => { setVatFilter(vatFilter === "8"  ? "" : "8");  setPage(1); }} />
            <PillFilter label="16%" active={vatFilter === "16"} onClick={() => { setVatFilter(vatFilter === "16" ? "" : "16"); setPage(1); }} />

            {/* Right side: clear · category · search · buttons */}
            <div className="ml-auto flex items-center gap-1.5">
              {hasFilters && (
                <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-800">
                  <FaTimes className="text-[9px]" /> Clear
                </button>
              )}
              <AppSelect
                value={categoryFilter}
                onChange={(v) => { setCategoryFilter(v ?? ""); setPage(1); }}
                options={categories.map((c) => ({ value: c._id, label: c.name }))}
                placeholder="All Categories"
                clearable size="sm" searchable
              />
              <div className="flex h-7 items-center gap-1.5 border border-slate-300 bg-white px-2 text-xs focus-within:border-[#0B3B2E]">
                <FaSearch className="shrink-0 text-[10px] text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Name, SKU, barcode…"
                  className="w-36 bg-transparent text-slate-700 placeholder-slate-400 outline-none"
                />
                {search && (
                  <button type="button" onClick={() => { setSearch(""); setPage(1); }} className="text-slate-400 hover:text-slate-600">
                    <FaTimes className="text-[9px]" />
                  </button>
                )}
              </div>
              <span className="mx-0.5 h-3.5 w-px bg-slate-300" />
              <button type="button" onClick={refetch}
                className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={() => setShowImport(true)}
                className="inline-flex h-7 items-center gap-1 border border-blue-300 bg-white px-2.5 text-[10px] font-bold text-blue-700 hover:bg-blue-50">
                <FaFileImport className="text-[9px]" /> Import
              </button>
              <button type="button" onClick={openAdd}
                className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New Product
              </button>
            </div>
          </div>
        )}

        {/* ── Scrollable table area ──────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    className="accent-emerald-400 h-3.5 w-3.5 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Name</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">SKU / Barcode</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Category</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Selling Price</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Cost</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">VAT</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Stock</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Status</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1,2,3,4,5].map((i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-3 py-2">
                        <div className="h-3 animate-pulse rounded bg-slate-100" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !products.length ? (
                <tr>
                  <td colSpan={10} className="px-3 py-16 text-center">
                    <FaBoxOpen className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">
                      {hasFilters ? "No products match your filters" : "No products yet"}
                    </p>
                    {hasFilters ? (
                      <button type="button" onClick={resetFilters} className="mt-1 text-xs font-bold text-[#0B3B2E] underline">Clear filters</button>
                    ) : (
                      <p className="mt-1 text-xs text-slate-400">Click <strong>+ New Product</strong> to start building your catalogue.</p>
                    )}
                  </td>
                </tr>
              ) : products.map((p, idx) => {
                const isSelected = selectedIds.has(p._id);
                return (
                  <tr
                    key={p._id}
                    onClick={() => toggleOne(p._id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors ${
                      isSelected ? "bg-emerald-50/70" : idx % 2 === 1 ? "bg-slate-50/40 hover:bg-[#F7FBF9]" : "hover:bg-[#F7FBF9]"
                    }`}
                  >
                    <td className="w-8 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(p._id)}
                        className="accent-[#0B3B2E] h-3.5 w-3.5 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5 font-bold text-slate-900">
                        <FaBoxOpen className="shrink-0 text-[10px] text-[#0B3B2E]" />
                        <span>{p.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      {p.sku && <div className="font-mono text-[11px] text-slate-600">{p.sku}</div>}
                      {p.barcode && (
                        <div className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
                          <FaBarcode className="shrink-0" /> {p.barcode}
                        </div>
                      )}
                      {!p.sku && !p.barcode && <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.category?.name
                        ? <span className="font-semibold text-[#0B3B2E]">{p.category.name}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-800">{formatMoney(p.sellingPrice)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{formatMoney(p.costPrice)}</td>
                    <td className="px-3 py-1.5 text-slate-500">{p.vatRate}%</td>
                    <td className="px-3 py-1.5">
                      {p.trackStock ? (
                        <div className="flex items-center gap-1">
                          <span className="inline-flex border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-blue-700">Tracked</span>
                          {p.serialized && (
                            <span className="inline-flex border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-violet-700">Serial</span>
                          )}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5"><StatusBadge status={p.active !== false ? "active" : "inactive"} /></td>
                    <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {p.trackStock && (
                          <button type="button" onClick={() => setStockCardProduct(p)} className="inline-flex items-center gap-1 border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-bold text-blue-600 hover:bg-blue-50">
                            <FaChartLine className="text-[9px]" /> Stock Card
                          </button>
                        )}
                        <button type="button" onClick={() => openEdit(p)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                          <FaEdit className="text-[9px]" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(p)}
                          className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-bold ${p.active !== false ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50"}`}
                        >
                          {p.active !== false ? <FaToggleOff className="text-[9px]" /> : <FaToggleOn className="text-[9px]" />}
                          {p.active !== false ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(`single:${p._id}`)}
                          className="inline-flex items-center gap-1 border border-red-200 bg-white px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-50"
                        >
                          <FaTrash className="text-[8px]" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Shared pagination bar ─────────────────────────────────── */}
        <PaginationBar
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          loading={loading}
        />
      </div>

      {showModal && (
        <Modal
          title={editing ? `Edit Product — ${editing.name}` : "New Product"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="product-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Saving…" : "Save Product"}
              </button>
            </>
          }
        >
          <form id="product-form" onSubmit={handleSave} className="grid grid-cols-2 gap-x-4 gap-y-3">

            {/* ── Basic Information ─────────────────────────────── */}
            <SectionHead>Basic Information</SectionHead>

            <div className="col-span-2">
              <label className={labelClass}>Product Name *</label>
              <input required autoFocus className={inputClass} value={form.name} onChange={set("name")} placeholder="e.g. Samsung Galaxy A15" />
            </div>
            <div>
              <label className={labelClass}>SKU</label>
              <input className={`${inputClass} uppercase`} value={form.sku} onChange={set("sku")} placeholder="Auto or manual" />
            </div>
            <div>
              <label className={labelClass}>Barcode / IMEI</label>
              <input className={inputClass} value={form.barcode} onChange={set("barcode")} placeholder="Scan or type" />
            </div>
            <div>
              <AppSelect label="Category" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v ?? "" }))} options={[{ value: "", label: "— None —" }, ...categories.map((c) => ({ value: c._id, label: c.name }))]} placeholder="— None —" size="md" searchable />
            </div>
            <div>
              <AppSelect label="Unit of Measure" value={UOM_OPTIONS.includes(form.unitOfMeasure) ? form.unitOfMeasure : "__custom"} onChange={(v) => { if (v && v !== "__custom") setForm((f) => ({ ...f, unitOfMeasure: v ?? "" })); }} options={[...UOM_OPTIONS.map((u) => ({ value: u, label: u })), ...(!UOM_OPTIONS.includes(form.unitOfMeasure) ? [{ value: "__custom", label: form.unitOfMeasure }] : []), { value: "__custom", label: "Other (custom)…" }]} size="md" />
              {!UOM_OPTIONS.includes(form.unitOfMeasure) && (
                <input className={`${inputClass} mt-1`} value={form.unitOfMeasure} onChange={set("unitOfMeasure")} placeholder="Enter custom unit" />
              )}
            </div>

            {/* ── Pricing & Tax ─────────────────────────────────── */}
            <SectionHead>Pricing &amp; Tax</SectionHead>

            <div>
              <label className={labelClass}>Cost Price (KES)</label>
              <input type="number" step="0.01" min="0" className={inputClass} value={form.costPrice} onChange={set("costPrice")} placeholder="0.00" />
            </div>
            <div>
              <label className={labelClass}>Selling Price (KES) *</label>
              <input required type="number" step="0.01" min="0" className={inputClass} value={form.sellingPrice} onChange={set("sellingPrice")} placeholder="0.00" />
            </div>
            <div>
              <AppSelect label="VAT Rate" value={form.vatRate} onChange={(v) => setForm((f) => ({ ...f, vatRate: v ?? "" }))} options={VAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} size="md" />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <input className={inputClass} value={form.description} onChange={set("description")} placeholder="Optional" />
            </div>

            {/* ── Inventory Settings ────────────────────────────── */}
            <SectionHead>Inventory Settings</SectionHead>

            <div className="col-span-2 flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-2.5 rounded border border-slate-200 bg-slate-50 px-3 py-2.5">
                <input type="checkbox" checked={form.trackStock} onChange={setCheck("trackStock")} className="accent-[#0B3B2E] h-4 w-4" />
                <div>
                  <div className="text-sm font-bold text-slate-800">Track stock for this product</div>
                  <div className="text-[11px] text-slate-500">Quantities are monitored across locations. Disable for services or non-physical items.</div>
                </div>
              </label>

              {form.trackStock && (
                <label className="flex cursor-pointer items-center gap-2.5 rounded border border-violet-200 bg-violet-50 px-3 py-2.5">
                  <input type="checkbox" checked={form.serialized} onChange={setCheck("serialized")} className="accent-violet-600 h-4 w-4" />
                  <div>
                    <div className="text-sm font-bold text-slate-800">Serialized product <span className="ml-1 border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-violet-700">Serial / IMEI</span></div>
                    <div className="text-[11px] text-slate-500">Each unit is tracked individually by a unique serial or IMEI number (e.g. phones, laptops, appliances).</div>
                  </div>
                </label>
              )}
            </div>

            {form.trackStock && (
              <div>
                <label className={labelClass}>Reorder Level</label>
                <input type="number" min="0" step="1" className={inputClass} value={form.reorderLevel} onChange={set("reorderLevel")} />
                <p className="mt-0.5 text-[10px] text-slate-400">Alert when stock falls below this quantity.</p>
              </div>
            )}
          </form>
        </Modal>
      )}

      {stockCardProduct && (
        <StockCardModal product={stockCardProduct} onClose={() => setStockCardProduct(null)} />
      )}

      <ProductsImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImport}
      />

      {confirmDelete && (
        <ConfirmModal
          danger
          title={confirmDelete === "bulk" ? "Delete Products" : "Delete Product"}
          message={
            confirmDelete === "bulk"
              ? `Permanently delete ${selCount} selected product(s)? Products with stock movements cannot be deleted.`
              : "Permanently delete this product? This cannot be undone."
          }
          onConfirm={() => {
            if (confirmDelete === "bulk") handleBulkDelete();
            else handleSingleDelete(confirmDelete.replace("single:", ""));
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </InventoryShell>
  );
};

export default InvProducts;
