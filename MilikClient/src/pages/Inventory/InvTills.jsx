import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaCashRegister, FaPlus, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";

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
  const [locFilter, setLocFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState(emptyForm());
  const [saving,    setSaving]    = useState(false);

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
    if (!window.confirm(`Delete "${till.name}"? This cannot be undone.`)) return;
    try {
      await inventoryApi.deleteTill(till._id);
      toast.success("Till deleted");
      queryClient.invalidateQueries({ queryKey: ['inv-tills'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Delete failed");
    }
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const activeCount = tills.filter((t) => t.isActive).length;

  return (
    <InventoryShell
      title="Tills & Registers"
      action={
        <>
          <button type="button" onClick={refetch} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#E67E00]">
            <FaPlus /> New Till
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Total: <strong className="text-[#0B3B2E]">{tills.length}</strong>
            {activeCount > 0 && <> &nbsp;·&nbsp; Active: <strong className="text-emerald-600">{activeCount}</strong></>}
          </span>
          <div className="ml-auto">
            <select
              value={locFilter}
              onChange={(e) => setLocFilter(e.target.value)}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]"
            >
              <option value="">All Locations</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <table className="w-full min-w-[600px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Till Name</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Location</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Description</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !tills.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-14 text-center">
                  <FaCashRegister className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">No tills configured</p>
                  <p className="mt-0.5 text-xs text-slate-400">Add a till for each physical cash register at your locations.</p>
                </td>
              </tr>
            ) : tills.map((till) => (
              <tr key={till._id} className="border-b border-slate-100 hover:bg-slate-50">
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
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button type="button" onClick={() => openEdit(till)} className="border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50">Edit</button>
                    <button type="button" onClick={() => toggleActive(till)} className={`border px-2 py-0.5 text-[10px] font-bold ${till.isActive ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                      {till.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button type="button" onClick={() => handleDelete(till)} className="border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-100">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
                <label className={labelClass}>Location *</label>
                <select required className={inputClass} value={form.location} onChange={set("location")}>
                  <option value="">— Select location —</option>
                  {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
                </select>
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
