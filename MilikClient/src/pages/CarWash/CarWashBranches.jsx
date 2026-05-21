import React, { useEffect, useState } from "react";
import { FaEdit, FaPlus, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const emptyForm = { name: "", location: "", address: "", phone: "", mpesaShortCode: "", active: true, isDefault: false };
const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const CarWashBranches = () => {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listBranches();
      setRows(normalizeListPayload(payload, "branches"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => toast.error("Failed to load branches"));
  }, []);

  const closeModal = () => { setShowModal(false); setEditingId(""); setForm(emptyForm); };

  const openCreate = () => { setEditingId(""); setForm(emptyForm); setShowModal(true); };

  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({
      name: row.name || "",
      location: row.location || "",
      address: row.address || "",
      phone: row.phone || "",
      mpesaShortCode: row.mpesaShortCode || "",
      active: row.active !== false,
      isDefault: row.isDefault === true,
    });
    setShowModal(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) await carWashApi.updateBranch(editingId, form);
      else await carWashApi.createBranch(form);
      closeModal();
      await load();
      toast.success("Branch saved");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save branch");
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete branch "${row.name}"? This cannot be undone.`)) return;
    try {
      await carWashApi.deleteBranch(row._id);
      await load();
      toast.success("Branch deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to delete branch");
    }
  };

  return (
    <CarWashShell
      title="Branch Management"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]">
            <FaPlus /> New Branch
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap min-h-8 items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Total: <strong className="text-[#0B3B2E]">{rows.length}</strong></span>
          <span>Active: <strong className="text-[#0B3B2E]">{rows.filter((r) => r.active !== false).length}</strong></span>
        </div>
        <table className="w-full min-w-[800px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Location</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Phone</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">M-Pesa Short Code</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row._id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1.5">
                    <span className="font-extrabold text-slate-900">{row.name}</span>
                    {row.isDefault && (
                      <span className="ml-2 inline-flex border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 uppercase">Default</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-slate-700">{row.location || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-700">{row.phone || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-700">{row.mpesaShortCode || "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${row.active === false ? "border-orange-200 bg-orange-50 text-orange-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                      {row.active === false ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                        <FaEdit /> Edit
                      </button>
                      {!row.isDefault && (
                        <button type="button" onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
                  {loading ? "Loading…" : "No branches yet. Create your first branch to get started."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal
          title={editingId ? "Edit Branch" : "Add Branch"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="submit" form="branch-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">Save Branch</button>
            </>
          }
        >
          <form id="branch-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Branch Name *</label>
              <input className={inputClass} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
            </div>
            <div>
              <label className={labelClass}>Location / Area</label>
              <input className={inputClass} value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="e.g. Westlands, CBD" />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input className={inputClass} value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Address</label>
              <input className={inputClass} value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>M-Pesa Paybill / Till Short Code</label>
              <input className={inputClass} value={form.mpesaShortCode} onChange={(e) => setForm((p) => ({ ...p, mpesaShortCode: e.target.value }))} placeholder="e.g. 522522" />
            </div>
            <div className="flex flex-col justify-end gap-3">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((p) => ({ ...p, isDefault: e.target.checked }))} />
                Set as default branch
              </label>
            </div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashBranches;
