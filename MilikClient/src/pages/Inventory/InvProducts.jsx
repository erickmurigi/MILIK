import React, { useMemo, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaArrowDown, FaArrowUp, FaBarcode, FaBoxOpen, FaChartLine, FaEdit, FaPlus, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";

const UOM_OPTIONS = ["pcs", "units", "kg", "g", "ltr", "ml", "m", "cm", "box", "pack", "dozen", "bag", "roll", "sheet", "pair", "set"];
const VAT_OPTIONS = [{ label: "0% (Exempt)", value: "0" }, { label: "8% (Reduced)", value: "8" }, { label: "16% (Standard)", value: "16" }];

const emptyForm = () => ({
  name: "", sku: "", barcode: "", category: "", unitOfMeasure: "pcs",
  costPrice: "", sellingPrice: "", vatRate: "16",
  trackStock: true, serialized: false,
  reorderLevel: "0", description: "",
});

const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

const SectionHead = ({ children }) => (
  <div className="col-span-2 border-b border-slate-100 pb-1 pt-1">
    <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">{children}</span>
  </div>
);

const StatusBadge = ({ active }) => (
  <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase ${active !== false ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-orange-200 bg-orange-50 text-orange-700"}`}>
    {active !== false ? "Active" : "Inactive"}
  </span>
);

const TYPE_LABELS = {
  purchase: "Purchase", sale: "Sale", return: "Return",
  transfer_out: "Transfer Out", transfer_in: "Transfer In",
  adjustment: "Adjustment", writeoff: "Write-off", opening: "Opening",
};

const Modal = ({ title, onClose, children, footer, wide }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className={`w-full border border-slate-200 bg-white shadow-2xl ${wide ? "max-w-4xl" : "max-w-xl"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white">
          <FaTimes />
        </button>
      </div>
      <div className="max-h-[78vh] overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

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

const InvProducts = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [stockCardProduct, setStockCardProduct] = useState(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['inv-categories-ref'],
    queryFn: async () => {
      const data = await inventoryApi.listCategories({ active: true });
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    staleTime: 5 * 60_000,
  });

  const { data: prodData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-products', search, categoryFilter, page],
    queryFn: async () => {
      const res = await inventoryApi.listProducts({ search, category: categoryFilter || undefined, page, limit: 50 });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { products: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load products"); }, [error]);

  const products = prodData?.products ?? [];
  const total = prodData?.total ?? 0;

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

  const activeCount = useMemo(() => products.filter((p) => p.active !== false).length, [products]);
  const trackedCount = useMemo(() => products.filter((p) => p.trackStock && p.active !== false).length, [products]);

  return (
    <InventoryShell
      title="Product Catalog"
      action={
        <>
          <button type="button" onClick={refetch} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={openAdd} className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#E67E00]">
            <FaPlus /> New Product
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Summary + filters strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Total: <strong className="text-[#0B3B2E]">{total}</strong>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Active: <strong className="text-[#0B3B2E]">{activeCount}</strong>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Tracked: <strong className="text-[#0B3B2E]">{trackedCount}</strong>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]"
            >
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-1.5 border border-slate-300 bg-white px-2 py-1 text-xs">
              <FaSearch className="text-slate-400 text-[10px]" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Name, SKU, barcode…"
                className="w-40 bg-transparent outline-none text-slate-700 placeholder-slate-400"
              />
            </div>
          </div>
        </div>

        <table className="w-full min-w-[800px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Name</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">SKU</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Category</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Selling Price</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Cost</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">VAT</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Stock</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !products.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-14 text-center">
                  <FaBoxOpen className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {search || categoryFilter ? "No products match your filters" : "No products yet"}
                  </p>
                  {!search && !categoryFilter && (
                    <p className="mt-0.5 text-xs text-slate-400">Add products to start building your inventory catalogue.</p>
                  )}
                </td>
              </tr>
            ) : products.map((p) => (
              <tr key={p._id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 font-extrabold text-slate-900">
                    <FaBoxOpen className="shrink-0 text-[#0B3B2E]" /> {p.name}
                  </span>
                  {p.barcode && (
                    <span className="mt-0.5 flex items-center gap-1 font-mono text-[9px] text-slate-400">
                      <FaBarcode /> {p.barcode}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-slate-500">{p.sku || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{p.category?.name || "—"}</td>
                <td className="px-3 py-2 text-right font-bold text-slate-800">{formatMoney(p.sellingPrice)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{formatMoney(p.costPrice)}</td>
                <td className="px-3 py-2 text-slate-500">{p.vatRate}%</td>
                <td className="px-3 py-2">
                  {p.trackStock ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="inline-flex border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">Tracked</span>
                      {p.serialized && (
                        <span className="inline-flex border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700">Serialized</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2"><StatusBadge active={p.active} /></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {p.trackStock && (
                      <button type="button" onClick={() => setStockCardProduct(p)} className="inline-flex items-center gap-1 border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-bold text-blue-600 hover:bg-blue-50">
                        <FaChartLine className="text-[9px]" /> Stock Card
                      </button>
                    )}
                    <button type="button" onClick={() => openEdit(p)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                      <FaEdit /> Edit
                    </button>
                    <button type="button" onClick={() => handleToggleActive(p)} className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-bold ${p.active !== false ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50"}`}>
                      {p.active !== false ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > 50 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#0B3B2E]">← Previous</button>
            <span className="text-xs text-slate-500">Page {page} of {Math.ceil(total / 50)}</span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={products.length < 50} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#0B3B2E]">Next →</button>
          </div>
        )}
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
              <label className={labelClass}>Category</label>
              <select className={inputClass} value={form.category} onChange={set("category")}>
                <option value="">— None —</option>
                {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Unit of Measure</label>
              <select className={inputClass} value={UOM_OPTIONS.includes(form.unitOfMeasure) ? form.unitOfMeasure : "__custom"} onChange={(e) => {
                if (e.target.value !== "__custom") setForm((f) => ({ ...f, unitOfMeasure: e.target.value }));
              }}>
                {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                {!UOM_OPTIONS.includes(form.unitOfMeasure) && <option value="__custom">{form.unitOfMeasure}</option>}
                <option value="__custom">Other (custom)…</option>
              </select>
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
              <label className={labelClass}>VAT Rate</label>
              <select className={inputClass} value={form.vatRate} onChange={set("vatRate")}>
                {VAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
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
    </InventoryShell>
  );
};

export default InvProducts;
