import React, { useEffect, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaArrowDown, FaArrowUp, FaClipboardCheck, FaPlus, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";

const ADJ_TYPES = {
  adjustment: {
    label: "Adjustment",
    desc:  "Count correction — physical count differs from system balance",
    color: "border-violet-200 bg-violet-50 text-violet-700",
  },
  writeoff: {
    label: "Write-off",
    desc:  "Permanently remove damaged, expired or lost stock",
    color: "border-red-200 bg-red-50 text-red-700",
  },
  opening: {
    label: "Opening Stock",
    desc:  "Initial stock entry when setting up a new product or location",
    color: "border-slate-200 bg-slate-50 text-slate-600",
  },
  return: {
    label: "Customer Return",
    desc:  "Goods returned by a customer — adds back to available stock",
    color: "border-blue-200 bg-blue-50 text-blue-700",
  },
};

const MANUAL_TYPE_CSV = Object.keys(ADJ_TYPES).join(",");

const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";
const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

const TypePill = ({ type }) => {
  const info = ADJ_TYPES[type] || { label: type, color: "border-slate-200 bg-slate-50 text-slate-600" };
  return (
    <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${info.color}`}>
      {info.label}
    </span>
  );
};

const emptyForm = () => ({ location: "", product: "", type: "adjustment", qty: "", unitCost: "", notes: "" });

const InvStockAdjustments = () => {
  const queryClient = useQueryClient();
  const [locFilter,  setLocFilter]  = useTabState("/inventory/adjustments:locFilter", "");
  const [typeFilter, setTypeFilter] = useTabState("/inventory/adjustments:typeFilter", "");
  const [page,       setPage]       = useTabState("/inventory/adjustments:page", 1);
  const [showModal,  setShowModal]  = useState(false);
  const [form,       setForm]       = useState(emptyForm());
  const [balance,    setBalance]    = useState(null);
  const [loadingBal, setLoadingBal] = useState(false);
  const [saving,     setSaving]     = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['inv-locations-ref'],
    queryFn: async () => { const d = await inventoryApi.listLocations({ active: true }); return Array.isArray(d) ? d : (d?.data ?? []); },
    staleTime: 5 * 60_000,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['inv-products-ref'],
    queryFn: async () => { const d = await inventoryApi.listProducts({ active: true, limit: 500 }); return Array.isArray(d) ? d : (d?.data ?? []); },
    staleTime: 5 * 60_000,
  });
  const { data: adjData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-stock-adjustments', locFilter, typeFilter, page],
    queryFn: async () => {
      const res = await inventoryApi.listMovements({ location: locFilter || undefined, type: typeFilter || MANUAL_TYPE_CSV, page, limit: 50 });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { entries: list, total: res?.total ?? 0 };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load adjustments"); }, [error]);

  const entries = adjData?.entries ?? [];
  const total = adjData?.total ?? 0;

  /* Fetch live balance when both product + location are selected */
  useEffect(() => {
    if (!form.product || !form.location) { setBalance(null); return; }
    setLoadingBal(true);
    inventoryApi.getBalance({ product: form.product, location: form.location })
      .then((res) => setBalance(res?.data?.balance ?? res?.balance ?? 0))
      .catch(() => setBalance(null))
      .finally(() => setLoadingBal(false));
  }, [form.product, form.location]);

  const closeModal = () => { setShowModal(false); setForm(emptyForm()); setBalance(null); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.notes.trim()) { toast.error("Reason is required for audit trail"); return; }
    const qty = Number(form.qty);
    if (!qty) { toast.error("Quantity cannot be zero"); return; }
    setSaving(true);
    try {
      await inventoryApi.createManualEntry({ ...form, qty, unitCost: Number(form.unitCost || 0) });
      toast.success("Stock adjustment posted");
      closeModal();
      queryClient.invalidateQueries({ queryKey: ['inv-stock-adjustments'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to post adjustment");
    } finally {
      setSaving(false);
    }
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const qtyNum  = Number(form.qty || 0);
  const typeInfo = ADJ_TYPES[form.type];
  const selectedProduct = products.find((p) => p._id === form.product);

  return (
    <InventoryShell
      title="Stock Adjustments"
      action={
        <>
          <button type="button" onClick={refetch} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={() => setShowModal(true)} className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#E67E00]">
            <FaPlus /> New Adjustment
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Adjustments: <strong className="text-[#0B3B2E]">{total}</strong>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={locFilter} onChange={(e) => { setLocFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]">
              <option value="">All Locations</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]">
              <option value="">All Types</option>
              {Object.entries(ADJ_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>

        <table className="w-full min-w-[850px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Date</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Product</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Location</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Type</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Qty</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Unit Cost</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Reason / Notes</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Posted By</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !entries.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-14 text-center">
                  <FaClipboardCheck className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">No adjustments found</p>
                  <p className="mt-0.5 text-xs text-slate-400">Manual corrections, write-offs, opening entries and customer returns appear here.</p>
                </td>
              </tr>
            ) : entries.map((entry) => {
              const isIn = Number(entry.qty) > 0;
              return (
                <tr key={entry._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleDateString("en-KE", { dateStyle: "short" })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{entry.product?.name || "—"}</div>
                    {entry.product?.sku && <div className="font-mono text-[10px] text-slate-400">{entry.product.sku}</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{entry.location?.name || "—"}</td>
                  <td className="px-3 py-2"><TypePill type={entry.type} /></td>
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-flex items-center gap-1 font-bold ${isIn ? "text-emerald-600" : "text-red-600"}`}>
                      {isIn ? <FaArrowUp className="text-[9px]" /> : <FaArrowDown className="text-[9px]" />}
                      {Math.abs(entry.qty)} {entry.product?.unitOfMeasure || ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatMoney(entry.unitCost)}</td>
                  <td className="px-3 py-2 text-slate-500">{entry.notes || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{entry.createdBy?.name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {total > 50 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#0B3B2E]">← Previous</button>
            <span className="text-xs text-slate-500">Page {page} of {Math.ceil(total / 50)}</span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={entries.length < 50} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#0B3B2E]">Next →</button>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">New Stock Adjustment</h2>
              <button type="button" onClick={closeModal} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>

            <form id="adj-form" onSubmit={handleSave} className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Location *</label>
                  <select required className={inputClass} value={form.location} onChange={set("location")}>
                    <option value="">— Select —</option>
                    {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Product *</label>
                  <select required className={inputClass} value={form.product} onChange={set("product")}>
                    <option value="">— Select —</option>
                    {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Live balance panel */}
              {form.product && form.location && (
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                  {loadingBal ? (
                    <span className="text-slate-400">Checking balance…</span>
                  ) : (
                    <span className="text-slate-700">
                      Current balance:{" "}
                      <strong className="text-[#0B3B2E]">
                        {balance ?? 0} {selectedProduct?.unitOfMeasure || "units"}
                      </strong>
                    </span>
                  )}
                </div>
              )}

              <div>
                <label className={labelClass}>Adjustment Type *</label>
                <select required className={inputClass} value={form.type} onChange={set("type")}>
                  {Object.entries(ADJ_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                {typeInfo && <p className="mt-1 text-[10px] text-slate-500">{typeInfo.desc}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>
                    Quantity *
                    <span className="ml-1 normal-case font-normal text-slate-400">(+ in / − out)</span>
                  </label>
                  <input
                    type="number" step="0.001" required
                    value={form.qty} onChange={set("qty")} placeholder="e.g. 10 or -5"
                    className={`${inputClass} ${qtyNum > 0 ? "border-emerald-400" : qtyNum < 0 ? "border-red-400" : ""}`}
                  />
                  {qtyNum !== 0 && (
                    <p className={`mt-0.5 text-[10px] font-bold ${qtyNum > 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {qtyNum > 0 ? "↑ Adding to stock" : "↓ Removing from stock"}
                      {balance !== null && (
                        <> → new balance:{" "}
                          <strong>{Math.round((balance + qtyNum) * 1000) / 1000}{" "}{selectedProduct?.unitOfMeasure || ""}</strong>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Unit Cost (KES)</label>
                  <input type="number" min="0" step="0.01" value={form.unitCost} onChange={set("unitCost")} placeholder="0.00" className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Reason *</label>
                <input
                  required value={form.notes} onChange={set("notes")}
                  placeholder="Be specific — e.g. 'Shelf count: 47 vs system 50, 3 missing'"
                  className={inputClass}
                />
                <p className="mt-0.5 text-[10px] text-slate-400">
                  Required for audit trail. Specific reasons (date, count, cause) make reconciliation easier.
                </p>
              </div>
            </form>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="adj-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Posting…" : "Post Adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </InventoryShell>
  );
};

export default InvStockAdjustments;
