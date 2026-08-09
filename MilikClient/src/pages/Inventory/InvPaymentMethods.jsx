import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaCashRegister, FaEdit, FaGripVertical, FaPlus, FaRedoAlt, FaTimes, FaToggleOff, FaToggleOn, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { useConfirm } from "../../context/ConfirmContext";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";

const emptyForm = () => ({ name: "", code: "", icon: "", requireRef: false, refLabel: "", sortOrder: "" });

const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

const StatusBadge = ({ active }) => (
  <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase ${active !== false ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-orange-200 bg-orange-50 text-orange-700"}`}>
    {active !== false ? "Active" : "Inactive"}
  </span>
);

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

const InvPaymentMethods = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const { data: methods = [], isLoading: loading, refetch } = useQuery({
    queryKey: ["inv-payment-methods"],
    queryFn: async () => {
      const data = await inventoryApi.listPaymentMethods();
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (m) => {
    setEditing(m);
    setForm({ name: m.name, code: m.code, icon: m.icon || "", requireRef: m.requireRef || false, refLabel: m.refLabel || "", sortOrder: String(m.sortOrder ?? "") });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["inv-payment-methods"] });

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, code: form.code, icon: form.icon, requireRef: form.requireRef, refLabel: form.refLabel, sortOrder: form.sortOrder !== "" ? Number(form.sortOrder) : undefined };
      if (editing) await inventoryApi.updatePaymentMethod(editing._id, payload);
      else await inventoryApi.createPaymentMethod(payload);
      closeModal(); invalidate();
      toast.success(`Payment method ${editing ? "updated" : "created"}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleToggleActive = async (m) => {
    try {
      await inventoryApi.updatePaymentMethod(m._id, { active: !m.active });
      invalidate();
      toast.success(`${m.name} ${m.active ? "deactivated" : "activated"}`);
    } catch { toast.error("Update failed"); }
  };

  const handleDelete = async (m) => {
    if (m.builtIn) { toast.error("Built-in payment methods cannot be deleted"); return; }
    const ok = await confirm({ title: "Delete Payment Method", message: `Delete "${m.name}"?`, confirmText: "Delete", isDangerous: true });
    if (!ok) return;
    try {
      await inventoryApi.deletePaymentMethod(m._id);
      invalidate(); toast.success("Payment method deleted");
    } catch (err) { toast.error(err?.response?.data?.message || "Delete failed"); }
  };

  // Selection
  const allPageIds   = useMemo(() => methods.map((m) => m._id), [methods]);
  const allSelected  = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected = allPageIds.some((id) => selectedIds.has(id));
  const selCount     = selectedIds.size;

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

  const handleBulkActivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updatePaymentMethod(id, { active: true })));
      toast.success(`${selCount} method(s) activated`);
      clearSelection(); invalidate();
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  const handleBulkDeactivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updatePaymentMethod(id, { active: false })));
      toast.success(`${selCount} method(s) deactivated`);
      clearSelection(); invalidate();
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {selCount > 0 ? (
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
            <button type="button" onClick={clearSelection}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800">
              <FaTimes className="text-[9px]" /> Clear selection
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
            <span className="text-[10px] font-semibold text-slate-500">Configure which payment methods appear at checkout. Sort order controls display sequence.</span>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={openAdd} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New Method
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
                </th>
                {["Order", "Icon", "Name", "Code", "Requires Ref", "Ref Label", "Type", "Status", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !methods.length ? (
                <tr>
                  <td colSpan={10} className="px-3 py-14 text-center">
                    <FaCashRegister className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">Loading payment methods…</p>
                    <p className="mt-0.5 text-xs text-slate-400">Default methods (Cash, M-Pesa, Card, Credit) will be seeded automatically.</p>
                  </td>
                </tr>
              ) : methods.map((m) => {
                const isSelected = selectedIds.has(m._id);
                return (
                  <tr key={m._id} onClick={() => toggleOne(m._id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                    <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(m._id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="flex items-center justify-center gap-1 text-slate-400">
                        <FaGripVertical className="text-[9px]" />
                        <span className="font-mono text-[10px] font-bold text-slate-600">{m.sortOrder}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-base">{m.icon || "—"}</td>
                    <td className="px-3 py-2 font-extrabold text-slate-900">{m.name}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700">{m.code}</span>
                    </td>
                    <td className="px-3 py-2">
                      {m.requireRef
                        ? <span className="inline-flex border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Yes</span>
                        : <span className="text-slate-400">No</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{m.refLabel || "—"}</td>
                    <td className="px-3 py-2">
                      {m.builtIn
                        ? <span className="inline-flex border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Built-in</span>
                        : <span className="inline-flex border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700">Custom</span>}
                    </td>
                    <td className="px-3 py-2"><StatusBadge active={m.active} /></td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => openEdit(m)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                          <FaEdit /> Edit
                        </button>
                        <button type="button" onClick={() => handleToggleActive(m)} className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-bold ${m.active !== false ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50"}`}>
                          {m.active !== false ? "Disable" : "Enable"}
                        </button>
                        {!m.builtIn && (
                          <button type="button" onClick={() => handleDelete(m)} className="inline-flex items-center border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
                            <FaTrash className="text-[9px]" />
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
      </div>

      {showModal && (
        <Modal title={editing ? "Edit Payment Method" : "Add Payment Method"} onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="pm-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }>
          <form id="pm-form" onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Name *</label>
                <input required autoFocus className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Bank Transfer" />
              </div>
              <div>
                <label className={labelClass}>Code *</label>
                <input required className={inputClass} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))} placeholder="e.g. bank" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Icon (emoji)</label>
                <input className={inputClass} value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} placeholder="e.g. 🏦" />
              </div>
              <div>
                <label className={labelClass}>Sort Order</label>
                <input type="number" min="0" className={inputClass} value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} placeholder="e.g. 5" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input type="checkbox" checked={form.requireRef} onChange={(e) => setForm((f) => ({ ...f, requireRef: e.target.checked }))}
                  className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                Require reference number at checkout
              </label>
            </div>
            {form.requireRef && (
              <div>
                <label className={labelClass}>Reference Label</label>
                <input className={inputClass} value={form.refLabel} onChange={(e) => setForm((f) => ({ ...f, refLabel: e.target.value }))} placeholder="e.g. Transaction Code" />
              </div>
            )}
          </form>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvPaymentMethods;
