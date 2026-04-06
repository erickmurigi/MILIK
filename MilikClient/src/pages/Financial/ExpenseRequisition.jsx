import React, { useEffect, useMemo, useState } from "react";
import { FaCheck, FaEdit, FaPlus, FaSave, FaSearch, FaSquare, FaTrash, FaTimes } from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  createExpenseRequisition,
  deleteExpenseRequisition,
  getExpenseRequisitions,
  getServiceProviders,
  updateExpenseRequisition,
  updateExpenseRequisitionStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";

const blankForm = {
  title: "",
  description: "",
  amount: "",
  requestDate: new Date().toISOString().split("T")[0],
  neededBy: "",
  priority: "normal",
  category: "general",
  property: "",
  serviceProvider: "",
  notes: "",
  status: "draft",
};

const statusPill = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-amber-100 text-amber-700",
};

const ExpenseRequisition = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const properties = useSelector((state) => state.property?.properties || []);

  const [rows, setRows] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "all" });
  const [form, setForm] = useState(blankForm);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const [reqs, serviceProviders] = await Promise.all([
        getExpenseRequisitions({ business: currentCompany._id, company: currentCompany._id, ...filters }),
        getServiceProviders({ business: currentCompany._id, company: currentCompany._id }),
      ]);
      setRows(Array.isArray(reqs) ? reqs : []);
      setProviders(Array.isArray(serviceProviders) ? serviceProviders : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load expense requisitions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [currentCompany?._id, filters.search, filters.status]);

  const filteredRows = useMemo(() => rows, [rows]);

  const stats = useMemo(() => ({
    total: filteredRows.length,
    submitted: filteredRows.filter((row) => row.status === "submitted").length,
    approvedAmount: filteredRows.filter((row) => row.status === "approved").reduce((sum, row) => sum + Number(row.amount || 0), 0),
  }), [filteredRows]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => prev.length === filteredRows.length ? [] : filteredRows.map((row) => row._id));
  };

  const openCreate = () => {
    setEditingId("");
    setForm(blankForm);
    setShowModal(true);
  };

  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({
      title: row.title || "",
      description: row.description || "",
      amount: row.amount || "",
      requestDate: row.requestDate ? new Date(row.requestDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      neededBy: row.neededBy ? new Date(row.neededBy).toISOString().split("T")[0] : "",
      priority: row.priority || "normal",
      category: row.category || "general",
      property: row.property?._id || row.property || "",
      serviceProvider: row.serviceProvider?._id || row.serviceProvider || "",
      notes: row.notes || "",
      status: row.status || "draft",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.warning("Requisition title is required");
      return;
    }
    if (!Number(form.amount || 0) || Number(form.amount) <= 0) {
      toast.warning("Valid amount is required");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount), business: currentCompany?._id, company: currentCompany?._id };
      const saved = editingId ? await updateExpenseRequisition(editingId, payload) : await createExpenseRequisition(payload);
      setRows((prev) => editingId ? prev.map((row) => row._id === editingId ? saved : row) : [saved, ...prev]);
      setShowModal(false);
      setEditingId("");
      setForm(blankForm);
      toast.success(`Expense requisition ${editingId ? "updated" : "saved"}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save expense requisition");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete requisition ${row.requisitionNo}?`)) return;
    try {
      await deleteExpenseRequisition(row._id, { business: currentCompany?._id, company: currentCompany?._id });
      setRows((prev) => prev.filter((item) => item._id !== row._id));
      setSelectedIds((prev) => prev.filter((id) => id !== row._id));
      toast.success("Expense requisition deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete expense requisition");
    }
  };

  const handleStatus = async (row, status) => {
    try {
      const saved = await updateExpenseRequisitionStatus(row._id, { status, business: currentCompany?._id, company: currentCompany?._id });
      setRows((prev) => prev.map((item) => item._id === row._id ? saved : item));
      toast.success(`Requisition ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to mark requisition ${status}`);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) {
      toast.info("Select requisitions first");
      return;
    }
    if (!window.confirm(`Delete ${selectedIds.length} selected requisitions?`)) return;
    for (const id of selectedIds) {
      const row = rows.find((item) => item._id === id);
      if (!row) continue;
      // Skip approved rows safely
      if (row.status === "approved") continue;
      // eslint-disable-next-line no-await-in-loop
      await deleteExpenseRequisition(id, { business: currentCompany?._id, company: currentCompany?._id }).catch(() => null);
    }
    await loadRows();
    setSelectedIds([]);
    toast.success("Selected draft/submitted requisitions cleaned up");
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-[96%] space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">Expenses Workflow</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900">Expense Requisition</h1>
                <p className="mt-1 text-sm text-slate-500">Raise, review, approve, reject, edit, and delete requisitions without breaking the downstream voucher workflow.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={handleBulkDelete} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">Delete Selected</button>
                <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white hover:bg-[#0A3127]"><FaPlus /> New Requisition</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Rows</p><p className="mt-2 text-2xl font-black text-slate-900">{stats.total}</p></div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Submitted</p><p className="mt-2 text-2xl font-black text-blue-700">{stats.submitted}</p></div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Approved Amount</p><p className="mt-2 text-2xl font-black text-emerald-700">KES {stats.approvedAmount.toLocaleString()}</p></div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="grid w-full max-w-4xl grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr),200px] xl:grid-cols-[minmax(0,1.5fr),200px,160px]">
                <div className="relative">
                  <FaSearch className="absolute left-3 top-3 text-sm text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search requisition no, title, description, category"
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <div className="hidden xl:flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black text-slate-600">
                  {selectedIds.length} selected
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left"><button type="button" onClick={toggleSelectAll}>{selectedIds.length === filteredRows.length && filteredRows.length > 0 ? <FaCheck /> : <FaSquare />}</button></th>
                    <th className="px-4 py-3 text-left">Requisition</th>
                    <th className="px-4 py-3 text-left">Property / Provider</th>
                    <th className="px-4 py-3 text-left">Need Date</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">Loading requisitions...</td></tr>
                  ) : filteredRows.length === 0 ? (
                    <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">No expense requisitions found.</td></tr>
                  ) : filteredRows.map((row, index) => (
                    <tr key={row._id} className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-4 py-3"><button type="button" onClick={() => toggleSelect(row._id)}>{selectedIds.includes(row._id) ? <FaCheck className="text-[#0B3B2E]" /> : <FaSquare className="text-slate-400" />}</button></td>
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-900">{row.requisitionNo}</div>
                        <div className="text-xs text-slate-500">{row.title}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{row.property?.propertyName || row.property?.name || "No property"}</div>
                        <div className="text-xs text-slate-500">{row.serviceProvider?.name || "No provider"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.neededBy ? new Date(row.neededBy).toLocaleDateString() : "-"}</td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">KES {Number(row.amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${statusPill[row.status] || statusPill.draft}`}>{row.status}</span></td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-2">
                          {row.status !== "approved" && <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700"><FaEdit /> Edit</button>}
                          {row.status === "draft" && <button onClick={() => handleStatus(row, "submitted")} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700"><FaCheck /> Submit</button>}
                          {row.status === "submitted" && <button onClick={() => handleStatus(row, "approved")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><FaCheck /> Approve</button>}
                          {row.status === "submitted" && <button onClick={() => handleStatus(row, "rejected")} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700"><FaTimes /> Reject</button>}
                          {row.status !== "approved" && <button onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700"><FaTrash /> Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Expense Requisition</p>
                <h3 className="text-xl font-black">{editingId ? "Edit Requisition" : "New Requisition"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              <label className="block xl:col-span-2"><span className="text-sm font-bold text-slate-700">Title</span><input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Amount</span><input type="number" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Property</span><select value={form.property} onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select property</option>{properties.map((property) => <option key={property._id} value={property._id}>{property.propertyCode ? `[${property.propertyCode}] ` : ""}{property.propertyName || property.name}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Service Provider</span><select value={form.serviceProvider} onChange={(e) => setForm((prev) => ({ ...prev, serviceProvider: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select provider</option>{providers.map((provider) => <option key={provider._id} value={provider._id}>{provider.providerCode} - {provider.name}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Priority</span><select value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Category</span><select value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="general">General</option><option value="maintenance">Maintenance</option><option value="repair">Repair</option><option value="utility">Utility</option><option value="tax">Tax</option><option value="insurance">Insurance</option><option value="supplies">Supplies</option><option value="other">Other</option></select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Request Date</span><input type="date" value={form.requestDate} onChange={(e) => setForm((prev) => ({ ...prev, requestDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Needed By</span><input type="date" value={form.neededBy} onChange={(e) => setForm((prev) => ({ ...prev, neededBy: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-3"><span className="text-sm font-bold text-slate-700">Description</span><textarea rows={3} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-3"><span className="text-sm font-bold text-slate-700">Internal Notes</span><textarea rows={2} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white disabled:opacity-60"><FaSave /> {saving ? "Saving..." : editingId ? "Update Requisition" : "Save Requisition"}</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default ExpenseRequisition;
