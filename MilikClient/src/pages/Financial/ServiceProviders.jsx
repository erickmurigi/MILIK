import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaEdit, FaPlus, FaSave, FaSearch, FaTimes, FaTrash } from "react-icons/fa";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  createServiceProvider,
  deleteServiceProvider,
  getServiceProviders,
  updateServiceProvider,
} from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import { useConfirm } from "../../context/ConfirmContext";

const blankForm = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  category: "general",
  kraPin: "",
  accountNumber: "",
  paybillNumber: "",
  bankName: "",
  accountName: "",
  isActive: true,
  notes: "",
};

const DEFAULT_PAGE_SIZE = 50;

const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "general", label: "General" },
  { value: "maintenance", label: "Maintenance" },
  { value: "utilities", label: "Utilities" },
  { value: "security", label: "Security" },
  { value: "cleaning", label: "Cleaning" },
  { value: "legal", label: "Legal" },
  { value: "contractor", label: "Contractor" },
  { value: "other", label: "Other" },
];

const ServiceProviders = () => {
  const confirm = useConfirm();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(blankForm);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);

  const canCreate = hasCompanyPermission(currentUser, currentCompany, "expenses", "create", "accounts");
  const canUpdate = hasCompanyPermission(currentUser, currentCompany, "expenses", "update", "accounts");
  const canDelete = hasCompanyPermission(currentUser, currentCompany, "expenses", "delete", "accounts");

  const _uid = currentUser?._id || currentUser?.id;
  const _spDraftKey = (currentCompany?._id && _uid) ? `milik:draft:service-provider:${currentCompany._id}:${_uid}` : null;
  const _spDraftRestored = useRef(false);

  useEffect(() => {
    if (!_spDraftKey || _spDraftRestored.current) return;
    _spDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_spDraftKey);
      if (raw) { const { form: s } = JSON.parse(raw); if (s) { setForm(s); setShowModal(true); } }
    } catch {}
  }, [_spDraftKey]);

  useEffect(() => {
    if (!_spDraftKey || !_spDraftRestored.current || !showModal || editingId) return;
    try { window.sessionStorage.setItem(_spDraftKey, JSON.stringify({ form })); } catch {}
  }, [_spDraftKey, form, showModal, editingId]);

  const closeModal = () => {
    if (_spDraftKey) { try { window.sessionStorage.removeItem(_spDraftKey); } catch {} }
    setShowModal(false);
    setEditingId("");
    setForm(blankForm);
  };

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const data = await getServiceProviders({
        business: currentCompany._id,
        company: currentCompany._id,
        search,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load service providers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [currentCompany?._id, search]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (nameFilter.trim()) {
        const providerName = String(row?.name || "").toLowerCase();
        if (!providerName.includes(nameFilter.trim().toLowerCase())) return false;
      }

      if (categoryFilter !== "all") {
        if (String(row?.category || "").toLowerCase() !== categoryFilter.toLowerCase()) {
          return false;
        }
      }

      if (search.trim()) {
        const haystack = `${row.providerCode} ${row.name} ${row.contactPerson} ${row.phone} ${row.email} ${row.category}`.toLowerCase();
        if (!haystack.includes(search.trim().toLowerCase())) return false;
      }

      return true;
    });
  }, [rows, search, nameFilter, categoryFilter]);


  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentPageRows = filtered.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, nameFilter, categoryFilter, pageSize]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const openCreate = () => {
    if (!canCreate) { toast.warning("You don't have permission to create service providers"); return; }
    setEditingId("");
    setForm(blankForm);
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (!canUpdate) { toast.warning("You don't have permission to edit service providers"); return; }
    setEditingId(row._id);
    setForm({
      name: row.name || "",
      contactPerson: row.contactPerson || "",
      phone: row.phone || "",
      email: row.email || "",
      category: row.category || "general",
      kraPin: row.kraPin || "",
      accountNumber: row.accountNumber || "",
      paybillNumber: row.paybillNumber || "",
      bankName: row.bankName || "",
      accountName: row.accountName || "",
      isActive: row.isActive !== false,
      notes: row.notes || "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.warning("Service provider name is required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        business: currentCompany?._id,
        company: currentCompany?._id,
      };

      const saved = editingId
        ? await updateServiceProvider(editingId, payload)
        : await createServiceProvider(payload);

      setRows((prev) =>
        editingId
          ? prev.map((row) => (row._id === editingId ? saved : row))
          : [saved, ...prev]
      );
      closeModal();
      toast.success(`Service provider ${editingId ? "updated" : "saved"}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save service provider");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!canDelete) { toast.warning("You don't have permission to delete service providers"); return; }
    if (!await confirm({ title: "Delete Service Provider", message: `Delete service provider ${row.name}?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await deleteServiceProvider(row._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setRows((prev) => prev.filter((item) => item._id !== row._id));
      toast.success("Service provider deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete service provider");
    }
  };

  const clearFilters = () => {
    setSearch("");
    setNameFilter("");
    setCategoryFilter("all");
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
              <div className="relative shrink-0">
                <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Provider code, contact, phone, email" className="h-7 w-52 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              </div>
              <input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="Provider name" className="h-7 w-36 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button onClick={clearFilters} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Clear</button>
              <button onClick={openCreate} disabled={!canCreate} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#FF8C00] px-2.5 text-xs font-semibold text-white hover:bg-[#e67e00] disabled:cursor-not-allowed disabled:bg-slate-300"><FaPlus size={10} /> Add Provider</button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 shadow-sm">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Code</th><th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Name</th><th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Contact</th><th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Category</th><th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Settlement</th><th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Status</th><th className="px-3 py-2 text-right font-black uppercase tracking-[0.14em]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (<tr><td colSpan="7" className="px-3 py-8 text-center text-slate-500">Loading service providers...</td></tr>) : filtered.length === 0 ? (<tr><td colSpan="7" className="px-3 py-8 text-center text-slate-500">No service providers found.</td></tr>) : (currentPageRows.map((row, index) => (
                  <tr key={row._id} className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"} hover:bg-slate-50`}>
                    <td className="px-3 py-1.5 font-mono font-bold text-slate-900">{row.providerCode}</td>
                    <td className="px-3 py-1.5"><div className="font-bold text-slate-900">{row.name}</div><div className="text-[11px] text-slate-500">{row.notes || "No notes"}</div></td>
                    <td className="px-3 py-1.5 text-slate-700"><div>{row.contactPerson || "-"}</div><div className="text-[11px] text-slate-500">{row.phone || row.email || "No contact"}</div></td>
                    <td className="px-3 py-1.5 text-slate-700">{row.category || "general"}</td>
                    <td className="px-3 py-1.5 text-slate-700">{row.bankName || row.paybillNumber || row.accountNumber || "-"}</td>
                    <td className="px-3 py-1.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${row.isActive !== false ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{row.isActive !== false ? "Active" : "Inactive"}</span></td>
                    <td className="px-3 py-1.5 text-right"><div className="inline-flex gap-1.5"><button onClick={() => openEdit(row)} disabled={!canUpdate} className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><FaEdit /> Edit</button><button onClick={() => handleDelete(row)} disabled={!canDelete} className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"><FaTrash /> Delete</button></div></td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            <div className="font-semibold">Showing <span className="font-bold text-slate-900">{filtered.length === 0 ? 0 : startIndex + 1}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, filtered.length)}</span> of <span className="font-bold text-slate-900">{filtered.length}</span> provider(s)</div>
            <div className="flex items-center gap-3"><div className="flex items-center gap-1.5"><span className="font-semibold text-slate-500">Per page:</span><select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition">{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}</select></div><button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button><span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span><button onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safeCurrentPage === totalPages} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Next</button></div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4 sm:items-center sm:p-6">
          <div className="flex w-full max-w-4xl max-h-[calc(100vh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">
                  Service Provider
                </p>
                <h3 className="text-xl font-black">{editingId ? "Edit Provider" : "Add Provider"}</h3>
              </div>
              <button
                onClick={closeModal}
                className="rounded-full border border-white/30 p-2 hover:bg-white/10"
              >
                <FaTimes />
              </button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2">
              {[
                ["name", "Provider Name"],
                ["contactPerson", "Contact Person"],
                ["phone", "Phone"],
                ["email", "Email"],
                ["category", "Category"],
                ["kraPin", "KRA PIN"],
                ["accountNumber", "Account Number"],
                ["paybillNumber", "Paybill / Till"],
                ["bankName", "Bank Name"],
                ["accountName", "Bank Account Name"],
              ].map(([field, label]) => (
                <label key={field} className="block">
                  <span className="text-sm font-bold text-slate-700">{label}</span>
                  <input
                    value={form[field]}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        [field]: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </label>
              ))}
              <label className="md:col-span-2 block">
                <span className="text-sm font-bold text-slate-700">Notes</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      notes: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                />
              </label>
              <label className="inline-flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      isActive: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                />
                <span className="text-sm font-bold text-slate-700">Active provider</span>
              </label>
            </div>
            <div className="sticky bottom-0 z-20 flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm">
              <button
                onClick={closeModal}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                <FaSave /> {saving ? "Saving..." : editingId ? "Update Provider" : "Save Provider"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default ServiceProviders;
