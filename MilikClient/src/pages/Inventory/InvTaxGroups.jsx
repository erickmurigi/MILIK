import React, { useCallback, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaEdit, FaPercent, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaToggleOff, FaToggleOn, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { useConfirm } from "../../context/ConfirmContext";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";

const emptyForm = () => ({ name: "", rate: "", type: "standard", description: "" });

const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

const TYPE_LABELS = { standard: "Standard", zero: "Zero-Rated", exempt: "Exempt" };
const TYPE_COLORS = {
  standard: "border-blue-200 bg-blue-50 text-blue-700",
  zero:     "border-emerald-200 bg-emerald-50 text-emerald-700",
  exempt:   "border-slate-200 bg-slate-50 text-slate-600",
};

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

const InvTaxGroups = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [search, setSearch] = useTabState("/inventory/setup/tax-groups:search", "");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const { data: taxGroups = [], isLoading: loading, refetch } = useQuery({
    queryKey: ["inv-tax-groups"],
    queryFn: async () => {
      const data = await inventoryApi.listTaxGroups();
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? taxGroups.filter((t) => t.name.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q)) : taxGroups;
  }, [search, taxGroups]);

  const openAdd  = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (t) => { setEditing(t); setForm({ name: t.name, rate: String(t.rate), type: t.type || "standard", description: t.description || "" }); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["inv-tax-groups"] });

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, rate: Number(form.rate), type: form.type, description: form.description };
      if (editing) await inventoryApi.updateTaxGroup(editing._id, payload);
      else await inventoryApi.createTaxGroup(payload);
      closeModal();
      invalidate();
      toast.success(`Tax group ${editing ? "updated" : "created"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  const handleToggleActive = async (t) => {
    try {
      await inventoryApi.updateTaxGroup(t._id, { active: !t.active });
      invalidate();
      toast.success(`Tax group ${t.active ? "deactivated" : "activated"}`);
    } catch { toast.error("Update failed"); }
  };

  const handleDelete = async (t) => {
    const ok = await confirm({ title: "Delete Tax Group", message: `Delete "${t.name}"?`, confirmText: "Delete", isDangerous: true });
    if (!ok) return;
    try {
      await inventoryApi.deleteTaxGroup(t._id);
      invalidate();
      toast.success("Tax group deleted");
    } catch (err) { toast.error(err?.response?.data?.message || "Delete failed"); }
  };

  // Selection
  const allPageIds   = useMemo(() => filtered.map((t) => t._id), [filtered]);
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
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateTaxGroup(id, { active: true })));
      toast.success(`${selCount} tax group(s) activated`);
      clearSelection(); invalidate();
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  const handleBulkDeactivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateTaxGroup(id, { active: false })));
      toast.success(`${selCount} tax group(s) deactivated`);
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
            <div className="flex h-7 items-center gap-1.5 border border-slate-300 bg-white px-2 text-xs focus-within:border-[#0B3B2E]">
              <FaSearch className="shrink-0 text-[10px] text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tax groups…"
                className="w-40 bg-transparent text-slate-700 placeholder-slate-400 outline-none" />
              {search && <button type="button" onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600"><FaTimes className="text-[9px]" /></button>}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={openAdd} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New Tax Group
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[600px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
                </th>
                {["Tax Group Name", "Rate", "Type", "Description", "Status", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={7} className="px-3 py-14 text-center">
                    <FaPercent className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">{search ? "No tax groups match your search" : "No tax groups yet"}</p>
                    {!search && <p className="mt-0.5 text-xs text-slate-400">Define VAT rates to apply on products (e.g. 16% Standard, 0% Zero-Rated, Exempt).</p>}
                  </td>
                </tr>
              ) : filtered.map((t) => {
                const isSelected = selectedIds.has(t._id);
                return (
                  <tr key={t._id} onClick={() => toggleOne(t._id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                    <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(t._id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 font-extrabold text-slate-900">
                        <FaPercent className="shrink-0 text-[#0B3B2E] text-[10px]" /> {t.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">{t.rate}%</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_COLORS[t.type] || TYPE_COLORS.standard}`}>
                        {TYPE_LABELS[t.type] || t.type}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-2 text-slate-500">{t.description || "—"}</td>
                    <td className="px-3 py-2"><StatusBadge active={t.active} /></td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => openEdit(t)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                          <FaEdit /> Edit
                        </button>
                        <button type="button" onClick={() => handleToggleActive(t)} className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-bold ${t.active !== false ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50"}`}>
                          {t.active !== false ? "Deactivate" : "Activate"}
                        </button>
                        <button type="button" onClick={() => handleDelete(t)} className="inline-flex items-center gap-1 border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
                          <FaTrash className="text-[9px]" />
                        </button>
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
        <Modal title={editing ? "Edit Tax Group" : "Add Tax Group"} onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="tax-group-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }>
          <form id="tax-group-form" onSubmit={handleSave} className="space-y-3">
            <div>
              <label className={labelClass}>Name *</label>
              <input required autoFocus className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard VAT" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Rate (%) *</label>
                <input required type="number" min="0" max="100" step="0.01" className={inputClass} value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} placeholder="e.g. 16" />
              </div>
              <div>
                <label className={labelClass}>Type *</label>
                <select required className={inputClass} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="standard">Standard</option>
                  <option value="zero">Zero-Rated</option>
                  <option value="exempt">Exempt</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full resize-none rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" placeholder="Optional…" />
            </div>
          </form>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvTaxGroups;
