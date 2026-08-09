import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaCashRegister, FaPlus, FaRedoAlt, FaTimes, FaToggleOff, FaToggleOn, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { useConfirm } from "../../context/ConfirmContext";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";

const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";
const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

const Modal = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const emptyForm = () => ({ location: "", name: "", description: "" });

const InvTills = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [locFilter, setLocFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState(emptyForm());
  const [saving,    setSaving]    = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['inv-locations-ref'],
    queryFn: async () => {
      const data = await inventoryApi.listLocations({ active: true });
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    staleTime: 5 * 60_000,
  });

  const { data: tills = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-tills', locFilter],
    queryFn: async () => {
      const t = await inventoryApi.listTills(locFilter ? { location: locFilter } : {});
      return Array.isArray(t) ? t : (t?.data ?? []);
    },
  });

  useEffect(() => { if (error) toast.error("Failed to load tills"); }, [error]);

  // Selection
  const allPageIds  = useMemo(() => tills.map((t) => t._id), [tills]);
  const allSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected = allPageIds.some((id) => selectedIds.has(id));
  const selCount    = selectedIds.size;

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
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateTill(id, { isActive: true })));
      toast.success(`${selCount} till(s) activated`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['inv-tills'] });
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  const handleBulkDeactivate = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selectedIds].map((id) => inventoryApi.updateTill(id, { isActive: false })));
      toast.success(`${selCount} till(s) deactivated`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['inv-tills'] });
    } catch { toast.error("Some updates failed"); }
    finally { setBulkWorking(false); }
  };

  const handleBulkDelete = async () => {
    const ok = await confirm({ title: "Delete Tills", message: `Delete ${selCount} till(s)? This cannot be undone.`, confirmText: "Delete", isDangerous: true });
    if (!ok) return;
    setBulkWorking(true);
    let failed = 0;
    await Promise.all([...selectedIds].map((id) => inventoryApi.deleteTill(id).catch(() => { failed++; })));
    if (failed) toast.error(`${failed} till(s) could not be deleted`);
    else toast.success(`${selCount} till(s) deleted`);
    clearSelection();
    queryClient.invalidateQueries({ queryKey: ['inv-tills'] });
    setBulkWorking(false);
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit   = (till) => {
    setEditing(till);
    setForm({ location: till.location?._id || till.location, name: till.name, description: till.description || "" });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.location) { toast.error("Select a location"); return; }
    if (!form.name.trim()) { toast.error("Till name is required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await inventoryApi.updateTill(editing._id, { name: form.name, description: form.description });
        toast.success("Till updated");
      } else {
        await inventoryApi.createTill({ location: form.location, name: form.name, description: form.description });
        toast.success("Till created");
      }
      closeModal();
      queryClient.invalidateQueries({ queryKey: ['inv-tills'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (till) => {
    try {
      await inventoryApi.updateTill(till._id, { isActive: !till.isActive });
      toast.success(till.isActive ? "Till deactivated" : "Till activated");
      queryClient.invalidateQueries({ queryKey: ['inv-tills'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update till");
    }
  };

  const handleDelete = async (till) => {
    const ok = await confirm({ title: "Delete Till", message: `Delete "${till.name}"? This cannot be undone.`, confirmText: "Delete", isDangerous: true });
    if (!ok) return;
    try {
      await inventoryApi.deleteTill(till._id);
      toast.success("Till deleted");
      queryClient.invalidateQueries({ queryKey: ['inv-tills'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Delete failed");
    }
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Toolbar: bulk action bar OR filter strip */}
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
            <button type="button" disabled={bulkWorking} onClick={handleBulkDelete}
              className="inline-flex items-center gap-1 border border-red-300 bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
              <FaTrash className="text-[9px]" /> Delete
            </button>
            <button type="button" onClick={clearSelection}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800">
              <FaTimes className="text-[9px]" /> Clear selection
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
            <AppSelect value={locFilter} onChange={(v) => setLocFilter(v ?? "")} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="All Locations" clearable size="sm" />
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={openCreate} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New Till
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
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Till Name</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Location</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Description</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Status</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !tills.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-14 text-center">
                    <FaCashRegister className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">No tills configured</p>
                    <p className="mt-0.5 text-xs text-slate-400">Add a till for each physical cash register at your locations.</p>
                  </td>
                </tr>
              ) : tills.map((till) => {
                const isSelected = selectedIds.has(till._id);
                return (
                  <tr key={till._id}
                    onClick={() => toggleOne(till._id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                    <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(till._id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-800">
                      <span className="flex items-center gap-1.5">
                        <FaCashRegister className="shrink-0 text-[#0B3B2E] text-[10px]" />
                        {till.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{till.location?.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{till.description || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${till.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                        {till.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex gap-1">
                        <button type="button" onClick={() => openEdit(till)} className="border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50">Edit</button>
                        <button type="button" onClick={() => toggleActive(till)} className={`border px-2 py-0.5 text-[10px] font-bold ${till.isActive ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                          {till.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button type="button" onClick={() => handleDelete(till)} className="border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-100">Delete</button>
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
          title={editing ? `Edit Till — ${editing.name}` : "New Till / Register"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="till-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Saving…" : editing ? "Save Changes" : "Create Till"}
              </button>
            </>
          }
        >
          <form id="till-form" onSubmit={handleSave} className="space-y-3">
            {!editing && (
              <div>
                <AppSelect label="Location" required value={form.location} onChange={(v) => setForm((f) => ({ ...f, location: v ?? "" }))} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="— Select location —" size="md" searchable />
              </div>
            )}
            {editing && (
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Location: <strong>{editing.location?.name}</strong>
              </div>
            )}
            <div>
              <label className={labelClass}>Till Name *</label>
              <input required className={inputClass} value={form.name} onChange={set("name")} placeholder="e.g. Till 1, Counter, Mobile Cashier" />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <input className={inputClass} value={form.description} onChange={set("description")} placeholder="Optional description" />
            </div>
            <div className="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              Each till represents a physical cash register. A session (shift) must be opened on a till before making sales.
            </div>
          </form>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvTills;
