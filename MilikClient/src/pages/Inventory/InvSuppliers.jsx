import React, { useCallback, useEffect, useState } from "react";
import { FaEdit, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaTruck } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";

const emptyForm = () => ({ name: "", contactName: "", phone: "", email: "", kraPin: "", address: "", notes: "" });

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#1a5c3a] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const StatusBadge = ({ active }) => (
  <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase ${active !== false ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-orange-200 bg-orange-50 text-orange-700"}`}>
    {active !== false ? "Active" : "Inactive"}
  </span>
);

const Modal = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#1a5c3a] px-4 py-3 text-white">
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

const InvSuppliers = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.listSuppliers({ search, page, limit: 30 });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setSuppliers(list);
      setTotal(res?.total ?? list.length);
    } catch {
      toast.error("Failed to load suppliers");
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, contactName: s.contactName || "", phone: s.phone || "", email: s.email || "", kraPin: s.kraPin || "", address: s.address || "", notes: s.notes || "" });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) await inventoryApi.updateSupplier(editing._id, form);
      else await inventoryApi.createSupplier(form);
      closeModal();
      await load();
      toast.success(`Supplier ${editing ? "updated" : "created"} successfully`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const activeCount = suppliers.filter((s) => s.active !== false).length;

  return (
    <InventoryShell
      title="Suppliers"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#1a5c3a] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={openAdd} className="inline-flex h-8 items-center gap-1.5 bg-[#1a5c3a] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#154d30]">
            <FaPlus /> New Supplier
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Summary + search strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Total: <strong className="text-[#1a5c3a]">{total}</strong>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Active: <strong className="text-[#1a5c3a]">{activeCount}</strong>
          </span>
          <div className="ml-auto flex items-center gap-1.5 border border-slate-300 bg-white px-2 py-1 text-xs">
            <FaSearch className="text-slate-400 text-[10px]" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search suppliers…"
              className="w-44 bg-transparent outline-none text-slate-700 placeholder-slate-400"
            />
          </div>
        </div>

        <table className="w-full min-w-[700px] text-xs">
          <thead className="bg-[#1a5c3a] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Name</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Contact</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Phone</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Email</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">KRA PIN</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !suppliers.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-14 text-center">
                  <FaTruck className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {search ? "No suppliers match your search" : "No suppliers yet"}
                  </p>
                  {!search && (
                    <p className="mt-0.5 text-xs text-slate-400">Add suppliers to manage your procurement and purchase orders.</p>
                  )}
                </td>
              </tr>
            ) : suppliers.map((s) => (
              <tr key={s._id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 font-extrabold text-slate-900">
                    <FaTruck className="shrink-0 text-[#1a5c3a]" /> {s.name}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{s.contactName || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{s.phone || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{s.email || "—"}</td>
                <td className="px-3 py-2 font-mono text-slate-600">{s.kraPin || "—"}</td>
                <td className="px-3 py-2"><StatusBadge active={s.active} /></td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => openEdit(s)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#1a5c3a] hover:bg-[#F1F6F3]">
                    <FaEdit /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal
          title={editing ? "Edit Supplier" : "Add Supplier"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="submit" form="supplier-form" disabled={saving} className="bg-[#1a5c3a] px-4 py-2 text-xs font-bold text-white hover:bg-[#154d30] disabled:opacity-50">
                {saving ? "Saving…" : "Save Supplier"}
              </button>
            </>
          }
        >
          <form id="supplier-form" onSubmit={handleSave} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Supplier Name *</label>
              <input required autoFocus className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Contact Person</label>
              <input className={inputClass} value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input type="tel" className={inputClass} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>KRA PIN</label>
              <input className={`${inputClass} uppercase`} value={form.kraPin} onChange={(e) => setForm((f) => ({ ...f, kraPin: e.target.value }))} placeholder="e.g. P051234567B" />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Address</label>
              <input className={inputClass} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-[#1a5c3a] resize-none" />
            </div>
          </form>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvSuppliers;
