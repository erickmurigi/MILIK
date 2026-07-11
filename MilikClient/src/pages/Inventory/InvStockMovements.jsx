import React, { useEffect, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaArrowDown, FaArrowUp, FaExchangeAlt, FaPlus, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";

const TYPE_LABELS = {
  purchase:      { label: "Purchase",     color: "border-emerald-200 bg-emerald-50 text-emerald-700", in: true },
  sale:          { label: "Sale",         color: "border-red-200    bg-red-50    text-red-700",       in: false },
  return:        { label: "Return",       color: "border-blue-200   bg-blue-50   text-blue-700",      in: true },
  transfer_out:  { label: "Transfer Out", color: "border-orange-200 bg-orange-50 text-orange-700",    in: false },
  transfer_in:   { label: "Transfer In",  color: "border-teal-200   bg-teal-50   text-teal-700",      in: true },
  adjustment:    { label: "Adjustment",   color: "border-violet-200 bg-violet-50 text-violet-700",    in: null },
  writeoff:      { label: "Write-off",    color: "border-red-200    bg-red-50    text-red-800",       in: false },
  opening:       { label: "Opening",      color: "border-slate-200  bg-slate-50  text-slate-600",     in: true },
};

const MANUAL_TYPES = ["adjustment", "writeoff", "opening", "return"];

const emptyForm = () => ({ location: "", product: "", type: "adjustment", qty: "", unitCost: "", notes: "" });

const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

const TypePill = ({ type }) => {
  const info = TYPE_LABELS[type] || { label: type, color: "border-slate-200 bg-slate-50 text-slate-600" };
  return <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${info.color}`}>{info.label}</span>;
};

const Modal = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const InvStockMovements = () => {
  const queryClient = useQueryClient();
  const [locationFilter, setLocationFilter] = useState("");
  const [typeFilter, setTypeFilter] = useTabState("/inventory/stock-movements:typeFilter", "");
  const [from, setFrom] = useTabState("/inventory/stock-movements:from", "");
  const [to, setTo] = useTabState("/inventory/stock-movements:to", "");
  const [page, setPage] = useTabState("/inventory/stock-movements:page", 1);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

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
  const { data: movData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-movements', locationFilter, typeFilter, from, to, page],
    queryFn: async () => {
      const res = await inventoryApi.listMovements({ location: locationFilter || undefined, type: typeFilter || undefined, from: from || undefined, to: to || undefined, page, limit: 50 });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { entries: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load movements"); }, [error]);

  const entries = movData?.entries ?? [];
  const total = movData?.total ?? 0;

  const closeModal = () => { setShowModal(false); setForm(emptyForm()); };

  const handleSave = async (e) => {
    e.preventDefault();
    const qty = Number(form.qty);
    if (!qty) { toast.error("Quantity cannot be zero"); return; }
    setSaving(true);
    try {
      await inventoryApi.createManualEntry({ ...form, qty, unitCost: Number(form.unitCost || 0) });
      closeModal();
      queryClient.invalidateQueries({ queryKey: ['inv-movements'] });
      toast.success("Stock entry posted");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const qtyNum = Number(form.qty || 0);

  return (
    <InventoryShell
      title="Stock Movements"
      action={
        <>
          <button type="button" onClick={refetch} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={() => setShowModal(true)} className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#E67E00]">
            <FaPlus /> Manual Entry
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Entries: <strong className="text-[#0B3B2E]">{total}</strong>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]">
              <option value="">All Locations</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]">
              <option value="">All Types</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <span>From</span>
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                className="border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-[#0B3B2E]" />
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <span>To</span>
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
                className="border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-[#0B3B2E]" />
            </div>
          </div>
        </div>

        <table className="w-full min-w-[800px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Date</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Product</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Location</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Type</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Qty</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Unit Cost</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Total Cost</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Reference</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">By</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !entries.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-14 text-center">
                  <FaExchangeAlt className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">No stock movements found</p>
                  {!locationFilter && !typeFilter && !from && !to && (
                    <p className="mt-0.5 text-xs text-slate-400">Movements are created automatically via purchase orders, sales, and transfers.</p>
                  )}
                </td>
              </tr>
            ) : entries.map((entry) => {
              const isIn = Number(entry.qty) > 0;
              return (
                <tr key={entry._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{new Date(entry.createdAt).toLocaleDateString("en-KE")}</td>
                  <td className="px-3 py-2 font-semibold text-slate-800">{entry.product?.name || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{entry.location?.name || "—"}</td>
                  <td className="px-3 py-2"><TypePill type={entry.type} /></td>
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-flex items-center gap-1 font-bold ${isIn ? "text-emerald-600" : "text-red-600"}`}>
                      {isIn ? <FaArrowUp className="text-[9px]" /> : <FaArrowDown className="text-[9px]" />}
                      {Math.abs(entry.qty)} {entry.product?.unitOfMeasure || ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatMoney(entry.unitCost)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-700">{formatMoney(entry.totalCost)}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{entry.reference || "—"}</td>
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
        <Modal title="Manual Stock Entry" onClose={closeModal} footer={
          <>
            <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" form="manual-entry-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
              {saving ? "Posting…" : "Post Entry"}
            </button>
          </>
        }>
          <form id="manual-entry-form" onSubmit={handleSave} className="grid grid-cols-2 gap-3">
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
            <div>
              <label className={labelClass}>Entry Type *</label>
              <select required className={inputClass} value={form.type} onChange={set("type")}>
                {MANUAL_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]?.label || t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Quantity *
                <span className="ml-1 normal-case font-normal text-slate-400">(+ in / − out)</span>
              </label>
              <input
                type="number"
                step="0.001"
                required
                className={`${inputClass} ${qtyNum > 0 ? "border-emerald-300 text-emerald-700" : qtyNum < 0 ? "border-red-300 text-red-700" : ""}`}
                value={form.qty}
                onChange={set("qty")}
                placeholder="e.g. 10 or -5"
              />
              {qtyNum !== 0 && (
                <p className={`mt-0.5 text-[10px] font-bold ${qtyNum > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {qtyNum > 0 ? "↑ Stock IN" : "↓ Stock OUT"}
                </p>
              )}
            </div>
            <div>
              <label className={labelClass}>Unit Cost (KES)</label>
              <input type="number" min="0" step="0.01" className={inputClass} value={form.unitCost} onChange={set("unitCost")} placeholder="0.00" />
            </div>
            <div>
              <label className={labelClass}>Notes / Reference</label>
              <input className={inputClass} value={form.notes} onChange={set("notes")} placeholder="Optional reason or ref" />
            </div>
          </form>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvStockMovements;
