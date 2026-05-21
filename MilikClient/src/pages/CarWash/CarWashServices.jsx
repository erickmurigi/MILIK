import React, { useEffect, useState } from "react";
import { FaChevronDown, FaChevronRight, FaEdit, FaPlus, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const emptyForm = { name: "", category: "", vehicleType: "", defaultPrice: "", active: true };
const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const PAGE_SIZE = 30;

const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white" title="Close">
          <FaTimes />
        </button>
      </div>
      <div className="p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const NEW_CATEGORY_SENTINEL = "__new__";

const CarWashServices = () => {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [appliedFilters, setAppliedFilters] = useState({ search: "", status: "" });
  const [expandedIds, setExpandedIds] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoryMode, setCategoryMode] = useState("select");

  const loadCategories = async () => {
    try {
      const result = await carWashApi.listServiceCategories();
      setCategories(Array.isArray(result) ? result : Array.isArray(result?.categories) ? result.categories : []);
    } catch {
      setCategories([]);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listServices({
        limit: PAGE_SIZE,
        page,
        search: appliedFilters.search || undefined,
        active: appliedFilters.status === "active" ? true : appliedFilters.status === "inactive" ? false : undefined,
      });
      const services = normalizeListPayload(payload, "services");
      setRows(services);
      setPagination(payload?.pagination || { page, limit: PAGE_SIZE, total: services.length, pages: 1 });
      setExpandedIds([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => toast.error("Failed to load services"));
  }, [appliedFilters, page]);

  useEffect(() => {
    loadCategories();
  }, []);

  const closeModal = () => {
    setShowModal(false);
    setEditingId("");
    setForm(emptyForm);
    setCategoryMode("select");
  };

  const openCreate = () => {
    setEditingId("");
    setForm(emptyForm);
    setCategoryMode("select");
    setShowModal(true);
  };

  const openEdit = (row) => {
    setEditingId(row._id);
    const catExists = categories.includes(row.category || "");
    setCategoryMode(row.category && !catExists ? "new" : "select");
    setForm({
      name: row.name || "",
      category: row.category || "",
      vehicleType: row.vehicleType || "",
      defaultPrice: row.defaultPrice || "",
      active: row.active !== false,
    });
    setShowModal(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = { ...form, defaultPrice: Number(form.defaultPrice || 0) };
    try {
      if (editingId) await carWashApi.updateService(editingId, payload);
      else await carWashApi.createService(payload);
      closeModal();
      await Promise.all([load(), loadCategories()]);
      toast.success("Service saved");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save service");
    }
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters({ search: "", status: "" });
    setPage(1);
    setAppliedFilters({ search: "", status: "" });
  };

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  return (
    <CarWashShell
      title="Services Register"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]">
            <FaPlus />
            New Service
          </button>
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 md:grid-cols-[1fr_220px_auto_auto]">
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Search service / category / vehicle"
          value={filters.search}
          onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
        />
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.status}
          onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch />
          Search
        </button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt />
          Reset
        </button>
      </form>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap min-h-8 items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Active: <strong className="text-[#0B3B2E]">{rows.filter((row) => row.active !== false).length}</strong></span>
          <span>Inactive: <strong className="text-[#FF8C00]">{rows.filter((row) => row.active === false).length}</strong></span>
        </div>
        <table className="w-full min-w-[940px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left" />
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Vehicle</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Price</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const expanded = expandedIds.includes(row._id);
                return (
                  <React.Fragment key={row._id}>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-1">
                        <button type="button" onClick={() => toggleExpanded(row._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]">
                          {expanded ? <FaChevronDown /> : <FaChevronRight />}
                        </button>
                      </td>
                      <td className="px-2 py-1 font-extrabold text-slate-900">{row.name}</td>
                      <td className="px-2 py-1 text-slate-700">{row.category || "-"}</td>
                      <td className="px-2 py-1 text-slate-700">{row.vehicleType || "-"}</td>
                      <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.defaultPrice)}</td>
                      <td className="px-2 py-1">
                        <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${row.active === false ? "border-orange-200 bg-orange-50 text-orange-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                          {row.active === false ? "Inactive" : "Active"}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                          <FaEdit />
                          Edit
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                        <td colSpan={7} className="px-10 py-2 text-[11px] text-slate-600">
                          <div className="grid gap-3 md:grid-cols-4">
                            <div><span className="font-extrabold uppercase text-slate-500">Created:</span> {row.createdAt ? new Date(row.createdAt).toLocaleDateString("en-KE") : "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Updated:</span> {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString("en-KE") : "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Service ID:</span> {row._id}</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No Car Wash services found.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Rows per page: {PAGE_SIZE}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1 || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Previous</button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button type="button" onClick={() => setPage((prev) => Math.min(prev + 1, pagination.pages))} disabled={page >= pagination.pages || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Next</button>
          </div>
        </div>
      </div>

      {showModal && (
        <Modal
          title={editingId ? "Edit Service" : "Create Service"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" form="carwash-service-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">
                Save Service
              </button>
            </>
          }
        >
          <form id="carwash-service-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelClass}>Service Name *</label>
              <input className={inputClass} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required autoFocus />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              {categoryMode === "new" ? (
                <div className="flex gap-1">
                  <input
                    className={inputClass}
                    value={form.category}
                    onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                    placeholder="Type new category…"
                    autoFocus
                  />
                  <button
                    type="button"
                    title="Pick from existing"
                    onClick={() => { setCategoryMode("select"); setForm((prev) => ({ ...prev, category: "" })); }}
                    className="border border-slate-300 bg-slate-50 px-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
                  >
                    ↩
                  </button>
                </div>
              ) : (
                <select
                  className={inputClass}
                  value={categories.includes(form.category) ? form.category : form.category ? NEW_CATEGORY_SENTINEL : ""}
                  onChange={(event) => {
                    if (event.target.value === NEW_CATEGORY_SENTINEL) {
                      setCategoryMode("new");
                      setForm((prev) => ({ ...prev, category: "" }));
                    } else {
                      setForm((prev) => ({ ...prev, category: event.target.value }));
                    }
                  }}
                >
                  <option value="">— No category —</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  <option value={NEW_CATEGORY_SENTINEL}>+ Add new category…</option>
                </select>
              )}
            </div>
            <div>
              <label className={labelClass}>Vehicle Type</label>
              <input className={inputClass} value={form.vehicleType} onChange={(event) => setForm((prev) => ({ ...prev, vehicleType: event.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Default Price *</label>
              <input className={inputClass} type="number" min="0" value={form.defaultPrice} onChange={(event) => setForm((prev) => ({ ...prev, defaultPrice: event.target.value }))} required />
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))} />
              Active
            </label>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashServices;
