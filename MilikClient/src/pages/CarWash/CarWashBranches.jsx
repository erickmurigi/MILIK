import React, { useEffect, useState } from "react";
import { FaEdit, FaPlus, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const METHODS = ["cash", "mpesa", "bank", "card", "other"];
const METHOD_LABELS = { cash: "Cash", mpesa: "M-Pesa", bank: "Bank Transfer", card: "Card / POS", other: "Other" };
const BRANCH_TYPE_LABELS = { vehicle: "Vehicle Wash", carpet: "Carpet / Textile", both: "Both" };
const BRANCH_TYPE_COLORS = {
  vehicle: "border-blue-200 bg-blue-50 text-blue-700",
  carpet:  "border-violet-200 bg-violet-50 text-violet-700",
  both:    "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const emptyDefaultCashbooks = METHODS.reduce((a, m) => { a[m] = ""; return a; }, {});
const emptyForm = {
  name: "", location: "", address: "", phone: "", mpesaShortCode: "",
  branchType: "both", defaultCashbooks: { ...emptyDefaultCashbooks },
  active: true, isDefault: false,
};

const inputClass  = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass  = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const selectClass = "h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="max-h-[80vh] overflow-y-auto p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const CarWashBranches = () => {
  const [rows, setRows]         = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [form, setForm]         = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading]   = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [branchPayload, cbPayload] = await Promise.all([
        carWashApi.listBranches(),
        carWashApi.listCashbooks(),
      ]);
      setRows(normalizeListPayload(branchPayload, "branches"));
      setCashbooks(normalizeListPayload(cbPayload, "accounts"));
    } catch {
      toast.error("Failed to load branches");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const closeModal = () => { setShowModal(false); setEditingId(""); setForm(emptyForm); };

  const openCreate = () => { setEditingId(""); setForm(emptyForm); setShowModal(true); };

  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({
      name:          row.name || "",
      location:      row.location || "",
      address:       row.address || "",
      phone:         row.phone || "",
      mpesaShortCode: row.mpesaShortCode || "",
      branchType:    row.branchType || "both",
      defaultCashbooks: METHODS.reduce((a, m) => {
        a[m] = row.defaultCashbooks?.[m]?._id || row.defaultCashbooks?.[m] || "";
        return a;
      }, {}),
      active:    row.active !== false,
      isDefault: row.isDefault === true,
    });
    setShowModal(true);
  };

  const setField = (field, value) => setForm((p) => ({ ...p, [field]: value }));
  const setCashbook = (method, value) =>
    setForm((p) => ({ ...p, defaultCashbooks: { ...p.defaultCashbooks, [method]: value } }));

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
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
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
                  <td className="px-2 py-1.5">
                    <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase ${BRANCH_TYPE_COLORS[row.branchType || "both"]}`}>
                      {BRANCH_TYPE_LABELS[row.branchType || "both"]}
                    </span>
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
                <td colSpan={7} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
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
          <form id="branch-form" onSubmit={submit} className="space-y-4">

            {/* Basic info */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className={labelClass}>Branch Name *</label>
                <input className={inputClass} value={form.name} onChange={(e) => setField("name", e.target.value)} required autoFocus />
              </div>
              <div>
                <label className={labelClass}>Location / Area</label>
                <input className={inputClass} value={form.location} onChange={(e) => setField("location", e.target.value)} placeholder="e.g. Westlands, CBD" />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input className={inputClass} value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Address</label>
                <input className={inputClass} value={form.address} onChange={(e) => setField("address", e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>M-Pesa Paybill / Till Short Code</label>
                <input className={inputClass} value={form.mpesaShortCode} onChange={(e) => setField("mpesaShortCode", e.target.value)} placeholder="e.g. 522522" />
              </div>
              <div>
                <label className={labelClass}>Branch Type</label>
                <select className={selectClass} value={form.branchType} onChange={(e) => setField("branchType", e.target.value)}>
                  <option value="both">Both (Vehicle + Carpet)</option>
                  <option value="vehicle">Vehicle Wash only</option>
                  <option value="carpet">Carpet / Textile only</option>
                </select>
                <p className="mt-1 text-[10px] text-slate-400">Controls which job types staff at this branch can create.</p>
              </div>
              <div className="flex flex-col justify-end gap-3">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={form.active} onChange={(e) => setField("active", e.target.checked)} />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={form.isDefault} onChange={(e) => setField("isDefault", e.target.checked)} />
                  Set as default branch
                </label>
              </div>
            </div>

            {/* Default cashbooks */}
            <div className="border border-slate-200">
              <div className="border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">Default Cashbooks for this Branch</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Override the business-wide defaults. Leave blank to fall back to company settings.
                </p>
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-2">
                {METHODS.map((method) => (
                  <div key={method}>
                    <label className={labelClass}>{METHOD_LABELS[method]}</label>
                    <select
                      className={selectClass}
                      value={form.defaultCashbooks[method]}
                      onChange={(e) => setCashbook(method, e.target.value)}
                    >
                      <option value="">— Use company default —</option>
                      {cashbooks.map((cb) => (
                        <option key={cb._id} value={cb._id}>{cb.code} – {cb.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashBranches;
