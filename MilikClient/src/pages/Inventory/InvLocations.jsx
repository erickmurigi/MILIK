import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaEdit, FaMapMarkerAlt, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaWarehouse } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";

const TYPES = ["warehouse", "retail", "counter"];

const emptyForm = () => ({ name: "", code: "", type: "retail", address: "", phone: "", isDefault: false });

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

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
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

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

  const activeCount = locations.filter((l) => l.active !== false).length;

  return (
    <InventoryShell
      title="Locations"
      action={
        <>
          <button type="button" onClick={refetch} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={openAdd} className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#E67E00]">
            <FaPlus /> New Location
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Summary + search strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Total: <strong className="text-[#0B3B2E]">{locations.length}</strong>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Active: <strong className="text-[#0B3B2E]">{activeCount}</strong>
          </span>
          <div className="ml-auto flex items-center gap-1.5 border border-slate-300 bg-white px-2 py-1 text-xs">
            <FaSearch className="text-slate-400 text-[10px]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search locations…"
              className="w-44 bg-transparent outline-none text-slate-700 placeholder-slate-400"
            />
          </div>
        </div>

        <table className="w-full min-w-[700px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Name</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Code</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Type</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Address</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Phone</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Default</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !filtered.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-14 text-center">
                  <FaWarehouse className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {search ? "No locations match your search" : "No locations yet"}
                  </p>
                  {!search && (
                    <p className="mt-0.5 text-xs text-slate-400">Add your first location to start managing inventory across branches.</p>
                  )}
                </td>
              </tr>
            ) : filtered.map((loc) => (
              <tr key={loc._id} className="border-b border-slate-100 hover:bg-slate-50">
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
                <td className="px-3 py-2 text-right">
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
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal
          title={editing ? "Edit Location" : "Add Location"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="submit" form="location-form" disabled={saving} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
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
              <label className={labelClass}>Type *</label>
              <select required className={inputClass} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                {TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
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
