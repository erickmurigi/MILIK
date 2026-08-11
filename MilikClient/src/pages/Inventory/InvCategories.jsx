import React, { useCallback, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaEdit, FaPlus, FaRedoAlt, FaSearch, FaTags, FaTimes, FaToggleOff, FaToggleOn } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";
import Modal from "../../components/common/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import { inputClass, labelClass } from "../../utils/formStyles";

const emptyForm = () => ({ name: "", description: "" });

const InvCategories = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useTabState("/inventory/categories:search", "");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const { data: categories = [], isLoading: loading, refetch } = useQuery({
    queryKey: ['inv-categories'],
    queryFn: async () => {
      const data = await inventoryApi.listCategories();
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? categories.filter((c) => c.name.toLowerCase().includes(q) || (c.description || "").toLowerCase().includes(q)) : categories;
  }, [search, categories]);

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (cat) => {
    setEditing(cat);
    setForm({ name: cat.name, description: cat.description || "" });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) await inventoryApi.updateCategory(editing._id, form);
      else await inventoryApi.createCategory(form);
      closeModal();
      queryClient.invalidateQueries({ queryKey: ['inv-categories'] });
      queryClient.invalidateQueries({ queryKey: ['inv-categories-ref'] });
      toast.success(`Category ${editing ? "updated" : "created"} successfully`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (cat) => {
    try {
      await inventoryApi.updateCategory(cat._id, { active: !cat.active });
      queryClient.invalidateQueries({ queryKey: ['inv-categories'] });
      queryClient.invalidateQueries({ queryKey: ['inv-categories-ref'] });
      toast.success(`Category ${cat.active ? "deactivated" : "activated"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Update failed");
    }
  };

  // Selection
  const allPageIds   = useMemo(() => filtered.map((c) => c._id), [filtered]);
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
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateCategory(id, { active: true })));
      toast.success(`${selCount} category(ies) activated`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['inv-categories'] });
      queryClient.invalidateQueries({ queryKey: ['inv-categories-ref'] });
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  const handleBulkDeactivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateCategory(id, { active: false })));
      toast.success(`${selCount} category(ies) deactivated`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['inv-categories'] });
      queryClient.invalidateQueries({ queryKey: ['inv-categories-ref'] });
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Toolbar */}
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
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories…"
                className="w-40 bg-transparent text-slate-700 placeholder-slate-400 outline-none" />
              {search && <button type="button" onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600"><FaTimes className="text-[9px]" /></button>}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={openAdd} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New Category
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[540px] text-xs">
          <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-2">
                <input type="checkbox" checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Category Name</th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Description</th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Status</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !filtered.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-14 text-center">
                  <FaTags className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {search ? "No categories match your search" : "No categories yet"}
                  </p>
                  {!search && (
                    <p className="mt-0.5 text-xs text-slate-400">Add product categories to organise your inventory catalogue.</p>
                  )}
                </td>
              </tr>
            ) : filtered.map((cat) => {
              const isSelected = selectedIds.has(cat._id);
              return (
                <tr key={cat._id}
                  onClick={() => toggleOne(cat._id)}
                  className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                  <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(cat._id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 font-extrabold text-slate-900">
                      <FaTags className="shrink-0 text-[#0B3B2E]" /> {cat.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[280px] truncate text-slate-500">{cat.description || "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={cat.active !== false ? "active" : "inactive"} /></td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(cat)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                        <FaEdit /> Edit
                      </button>
                      <button type="button" onClick={() => handleToggleActive(cat)} className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-bold ${cat.active !== false ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50"}`}>
                        {cat.active !== false ? "Deactivate" : "Activate"}
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
        <Modal
          title={editing ? "Edit Category" : "Add Category"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="category-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Saving…" : "Save Category"}
              </button>
            </>
          }
        >
          <form id="category-form" onSubmit={handleSave} className="space-y-3">
            <div>
              <label className={labelClass}>Category Name *</label>
              <input required autoFocus className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Electronics, Beverages" />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 resize-none" placeholder="Optional description…" />
            </div>
          </form>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvCategories;
