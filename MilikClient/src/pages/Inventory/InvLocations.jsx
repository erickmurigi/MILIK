import React, { useCallback, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaEdit, FaMapMarkerAlt, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaToggleOff, FaToggleOn, FaWarehouse } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";

const TYPES = ["warehouse", "retail", "counter"];

const emptyForm = () => ({ name: "", code: "", type: "retail", address: "", phone: "", isDefault: false });

const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

const TYPE_STYLES = {
  warehouse: "border-blue-200 bg-blue-50 text-blue-700",
  retail: "border-emerald-200 bg-emerald-50 text-emerald-700",
  counter: "border-amber-200 bg-amber-50 text-amber-700",
};

const TypeBadge = ({ type }) => (
  <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_STYLES[type] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
    {type}
  </span>
);

const StatusBadge = ({ active }) => (
  <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-orange-200 bg-orange-50 text-orange-700"}`}>
    {active ? "Active" : "Inactive"}
  </span>
);

const Modal = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white">
          <FaTimes />
        </button>
      </div>
      <div className="p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const InvLocations = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useTabState("/inventory/locations:search", "");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const { data: locations = [], isLoading: loading, refetch } = useQuery({
    queryKey: ['inv-locations'],
    queryFn: async () => {
      const data = await inventoryApi.listLocations();
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? locations.filter((l) => l.name.toLowerCase().includes(q) || (l.code || "").toLowerCase().includes(q) || (l.address || "").toLowerCase().includes(q)) : locations;
  }, [search, locations]);

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (loc) => {
    setEditing(loc);
    setForm({ name: loc.name, code: loc.code || "", type: loc.type, address: loc.address || "", phone: loc.phone || "", isDefault: loc.isDefault || false });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) await inventoryApi.updateLocation(editing._id, form);
      else await inventoryApi.createLocation(form);
      closeModal();
      queryClient.invalidateQueries({ queryKey: ['inv-locations'] });
      queryClient.invalidateQueries({ queryKey: ['inv-locations-ref'] });
      toast.success(`Location ${editing ? "updated" : "created"} successfully`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (loc) => {
    try {
      await inventoryApi.updateLocation(loc._id, { active: !loc.active });
      queryClient.invalidateQueries({ queryKey: ['inv-locations'] });
      queryClient.invalidateQueries({ queryKey: ['inv-locations-ref'] });
      toast.success(`Location ${loc.active ? "deactivated" : "activated"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Update failed");
    }
  };

  // Selection
  const allPageIds   = useMemo(() => filtered.map((l) => l._id), [filtered]);
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

  const [bulkWorking, setBulkWorking] = useState(false);

  const handleBulkActivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateLocation(id, { active: true })));
      toast.success(`${selCount} location(s) activated`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['inv-locations'] });
      queryClient.invalidateQueries({ queryKey: ['inv-locations-ref'] });
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  const handleBulkDeactivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateLocation(id, { active: false })));
      toast.success(`${selCount} location(s) deactivated`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['inv-locations'] });
      queryClient.invalidateQueries({ queryKey: ['inv-locations-ref'] });
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
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search locations…"
                className="w-40 bg-transparent text-slate-700 placeholder-slate-400 outline-none" />
              {search && <button type="button" onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600"><FaTimes className="text-[9px]" /></button>}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={openAdd} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New Location
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[740px] text-xs">
          <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-2">
                <input type="checkbox" checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Name</th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Code</th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Type</th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Address</th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Phone</th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Default</th>
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Status</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !filtered.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-14 text-center">
                  <FaWarehouse className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {search ? "No locations match your search" : "No locations yet"}
                  </p>
                  {!search && (
                    <p className="mt-0.5 text-xs text-slate-400">Add your first location to start managing inventory across branches.</p>
                  )}
                </td>
              </tr>
            ) : filtered.map((loc) => {
              const isSelected = selectedIds.has(loc._id);
              return (
                <tr key={loc._id}
                  onClick={() => toggleOne(loc._id)}
                  className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                  <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(loc._id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 font-extrabold text-slate-900">
                      <FaMapMarkerAlt className="shrink-0 text-[#0B3B2E]" /> {loc.name}
                    </span>
                    {loc.isDefault && (
                      <span className="mt-0.5 inline-flex border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">Default</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">{loc.code || "—"}</td>
                  <td className="px-3 py-2"><TypeBadge type={loc.type} /></td>
                  <td className="px-3 py-2 max-w-[180px] truncate text-slate-600">{loc.address || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{loc.phone || "—"}</td>
                  <td className="px-3 py-2">
                    {loc.isDefault
                      ? <span className="inline-flex border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Yes</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2"><StatusBadge active={loc.active !== false} /></td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(loc)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                        <FaEdit /> Edit
                      </button>
                      <button type="button" onClick={() => handleToggleActive(loc)} className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-bold ${loc.active !== false ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50"}`}>
                        {loc.active !== false ? "Deactivate" : "Activate"}
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
          title={editing ? "Edit Location" : "Add Location"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="location-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Saving…" : "Save Location"}
              </button>
            </>
          }
        >
          <form id="location-form" onSubmit={handleSave} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Name *</label>
              <input required autoFocus className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Code</label>
              <input className={`${inputClass} uppercase`} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. WH-01" />
            </div>
            <div>
              <AppSelect label="Type" required value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v ?? "" }))} options={TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} size="md" />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Address</label>
              <input className={inputClass} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input className={inputClass} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} className="accent-[#0B3B2E]" />
                Set as default location
              </label>
            </div>
          </form>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvLocations;
