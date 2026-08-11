import React, { useEffect, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaArrowDown, FaArrowUp, FaClipboardCheck, FaPlus, FaRedoAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";

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
  const [pageSize,   setPageSize]   = useTabState("/inventory/adjustments:pageSize", 50);
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
    queryKey: ['inv-stock-adjustments', locFilter, typeFilter, page, pageSize],
    queryFn: async () => {
      const res = await inventoryApi.listMovements({ location: locFilter || undefined, type: typeFilter || MANUAL_TYPE_CSV, page, limit: pageSize });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { entries: list, total: res?.total ?? 0 };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load adjustments"); }, [error]);

  const entries = adjData?.entries ?? [];
  const total = adjData?.total ?? 0;
  const pages = Math.ceil(total / pageSize) || 1;

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
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Filter + action strip */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
          <AppSelect value={locFilter} onChange={(v) => { setLocFilter(v ?? ""); setPage(1); }} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="All Locations" clearable size="sm" />
          <AppSelect value={typeFilter} onChange={(v) => { setTypeFilter(v ?? ""); setPage(1); }} options={Object.entries(ADJ_TYPES).map(([k, v]) => ({ value: k, label: v.label }))} placeholder="All Types" clearable size="sm" />
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaRedoAlt className={loading ? "animate-spin" : ""} />
            </button>
            <button type="button" onClick={() => setShowModal(true)} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
              <FaPlus /> New Adjustment
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[850px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Date</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Product</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Location</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Type</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Qty</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Unit Cost</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Reason / Notes</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Posted By</th>
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
        </div>

        <PaginationBar
          page={page} pages={pages} total={total} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          loading={loading}
          pageSizes={[25, 50, 100, 200]}
        />
      </div>

      {showModal && (
        <Modal
          title="New Stock Adjustment"
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="adj-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Posting…" : "Post Adjustment"}
              </button>
            </>
          }
        >
          <form id="adj-form" onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <AppSelect label="Location" required value={form.location} onChange={(v) => setForm((f) => ({ ...f, location: v ?? "" }))} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="— Select —" size="md" searchable />
              </div>
              <div>
                <AppSelect label="Product" required value={form.product} onChange={(v) => setForm((f) => ({ ...f, product: v ?? "" }))} options={products.map((p) => ({ value: p._id, label: p.name }))} placeholder="— Select —" size="md" searchable />
              </div>
            </div>

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
              <AppSelect label="Adjustment Type" required value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v ?? "" }))} options={Object.entries(ADJ_TYPES).map(([k, v]) => ({ value: k, label: v.label }))} size="md" />
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
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvStockAdjustments;
