import React, { useCallback, useEffect, useState } from "react";
import { FaBarcode, FaBoxOpen, FaEdit, FaPlus, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
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

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#1a5c3a] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const SectionHead = ({ children }) => (
  <div className="col-span-2 border-b border-slate-100 pb-1 pt-1">
    <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#1a5c3a]">{children}</span>
  </div>
);

const StatusBadge = ({ active }) => (
  <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase ${active !== false ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-orange-200 bg-orange-50 text-orange-700"}`}>
    {active !== false ? "Active" : "Inactive"}
  </span>
);

const Modal = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#1a5c3a] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white">
          <FaTimes />
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const InvProducts = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, cats] = await Promise.all([
        inventoryApi.listProducts({ search, category: categoryFilter || undefined, page, limit: 50 }),
        categories.length ? Promise.resolve(categories) : inventoryApi.listCategories({ active: true }),
      ]);
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setProducts(list);
      setTotal(res?.total ?? list.length);
      if (Array.isArray(cats)) setCategories(cats);
      else if (Array.isArray(cats?.data)) setCategories(cats.data);
    } catch {
      toast.error("Failed to load products");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, page]);

  useEffect(() => { load(); }, [load]);

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
      await load();
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
      await load();
      toast.success(`Product ${p.active ? "deactivated" : "activated"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Update failed");
    }
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const setCheck = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.checked }));

  const activeCount = products.filter((p) => p.active !== false).length;
  const trackedCount = products.filter((p) => p.trackStock && p.active !== false).length;

  return (
    <InventoryShell
      title="Product Catalog"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#1a5c3a] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={openAdd} className="inline-flex h-8 items-center gap-1.5 bg-[#1a5c3a] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#154d30]">
            <FaPlus /> New Product
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Summary + filters strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Total: <strong className="text-[#1a5c3a]">{total}</strong>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Active: <strong className="text-[#1a5c3a]">{activeCount}</strong>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Tracked: <strong className="text-[#1a5c3a]">{trackedCount}</strong>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#1a5c3a]"
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
          <thead className="bg-[#1a5c3a] text-white">
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
                    <FaBoxOpen className="shrink-0 text-[#1a5c3a]" /> {p.name}
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
                    <button type="button" onClick={() => openEdit(p)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#1a5c3a] hover:bg-[#F1F6F3]">
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
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#1a5c3a]">← Previous</button>
            <span className="text-xs text-slate-500">Page {page} of {Math.ceil(total / 50)}</span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={products.length < 50} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#1a5c3a]">Next →</button>
          </div>
        )}
      </div>

      {showModal && (
        <Modal
          title={editing ? `Edit Product — ${editing.name}` : "New Product"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="submit" form="product-form" disabled={saving} className="bg-[#1a5c3a] px-4 py-2 text-xs font-bold text-white hover:bg-[#154d30] disabled:opacity-50">
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
                <input type="checkbox" checked={form.trackStock} onChange={setCheck("trackStock")} className="accent-[#1a5c3a] h-4 w-4" />
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
    </InventoryShell>
  );
};

export default InvProducts;
