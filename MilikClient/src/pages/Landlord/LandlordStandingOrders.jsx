import React, { useEffect, useMemo, useState } from "react";
import { FaCalendarAlt, FaCheck, FaEdit, FaPause, FaPlay, FaPlus, FaSave, FaSearch, FaSquare, FaStop, FaTimes, FaTrash } from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  createLandlordStandingOrder,
  deleteLandlordStandingOrder,
  getLandlordStandingOrders,
  getLandlords,
  runLandlordStandingOrder,
  updateLandlordStandingOrder,
  updateLandlordStandingOrderStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";

const blankForm = {
  landlord: "",
  property: "",
  title: "",
  narration: "",
  amount: "",
  frequency: "monthly",
  startDate: new Date().toISOString().split("T")[0],
  endDate: "",
  paymentMethod: "bank_transfer",
  status: "draft",
};

const statusPills = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  stopped: "bg-rose-100 text-rose-700",
};

const LandlordStandingOrders = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const landlords = useSelector((state) => state.landlord?.landlords || []);
  const properties = useSelector((state) => state.property?.properties || []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "all" });
  const [form, setForm] = useState(blankForm);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getLandlords({ company: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const data = await getLandlordStandingOrders({ business: currentCompany._id, company: currentCompany._id, ...filters });
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load standing orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [currentCompany?._id, filters.search, filters.status]);

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.status === "active").length,
    processed: rows.reduce((sum, row) => sum + Number(row.totalProcessedAmount || 0), 0),
  }), [rows]);

  const openCreate = () => {
    setEditingId("");
    setForm(blankForm);
    setShowModal(true);
  };

  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({
      landlord: row.landlord?._id || row.landlord || "",
      property: row.property?._id || row.property || "",
      title: row.title || "",
      narration: row.narration || "",
      amount: row.amount || "",
      frequency: row.frequency === "annually" ? "yearly" : row.frequency || "monthly",
      startDate: row.startDate ? new Date(row.startDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      endDate: row.endDate ? new Date(row.endDate).toISOString().split("T")[0] : "",
      paymentMethod: row.paymentMethod === "mobile_money" ? "mpesa" : row.paymentMethod === "check" ? "cheque" : row.paymentMethod || "bank_transfer",
      status: row.status || "draft",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.landlord) return toast.warning("Landlord is required");
    if (!form.title.trim()) return toast.warning("Standing order title is required");
    if (!Number(form.amount || 0) || Number(form.amount) <= 0) return toast.warning("Valid amount is required");
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount), business: currentCompany?._id, company: currentCompany?._id };
      const saved = editingId ? await updateLandlordStandingOrder(editingId, payload) : await createLandlordStandingOrder(payload);
      setRows((prev) => editingId ? prev.map((row) => row._id === editingId ? saved : row) : [saved, ...prev]);
      setShowModal(false);
      setEditingId("");
      setForm(blankForm);
      toast.success(`Standing order ${editingId ? "updated" : "saved"}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save standing order");
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (row, status) => {
    try {
      const saved = await updateLandlordStandingOrderStatus(row._id, { status, business: currentCompany?._id, company: currentCompany?._id });
      setRows((prev) => prev.map((item) => item._id === row._id ? saved : item));
      toast.success(`Standing order marked ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to mark standing order ${status}`);
    }
  };

  const handleRun = async (row) => {
    try {
      const saved = await runLandlordStandingOrder(row._id, { business: currentCompany?._id, company: currentCompany?._id, note: row.narration || row.title });
      setRows((prev) => prev.map((item) => item._id === row._id ? saved : item));
      toast.success("Standing order processed successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to process standing order");
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete standing order ${row.standingOrderNo}?`)) return;
    try {
      await deleteLandlordStandingOrder(row._id, { business: currentCompany?._id, company: currentCompany?._id });
      setRows((prev) => prev.filter((item) => item._id !== row._id));
      setSelectedIds((prev) => prev.filter((id) => id !== row._id));
      toast.success("Standing order deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete standing order");
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelectedIds((prev) => prev.length === rows.length ? [] : rows.map((row) => row._id));

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.includes(row._id)), [rows, selectedIds]);

  const bulkRunSelected = async () => {
    if (selectedRows.length === 0) return toast.info("Select standing orders first");
    for (const row of selectedRows) {
      // eslint-disable-next-line no-await-in-loop
      await runLandlordStandingOrder(row._id, { business: currentCompany?._id, company: currentCompany?._id, note: row.narration || row.title }).catch(() => null);
    }
    await loadRows();
    toast.success("Selected standing orders processed");
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-[96%] space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">Landlord Payments</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900">Landlord Standing Orders</h1>
                <p className="mt-1 text-sm text-slate-500">Add orders in a popup, list them on the main page, edit, delete, select, activate, pause, stop, and process runs safely.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={bulkRunSelected} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">Run Selected</button>
                <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white hover:bg-[#0A3127]"><FaPlus /> Add Standing Order</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Orders</p><p className="mt-2 text-2xl font-black text-slate-900">{stats.total}</p></div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Active</p><p className="mt-2 text-2xl font-black text-emerald-700">{stats.active}</p></div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Processed Value</p><p className="mt-2 text-2xl font-black text-blue-700">KES {stats.processed.toLocaleString()}</p></div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr,220px,180px]">
              <div className="relative"><FaSearch className="absolute left-3 top-3.5 text-slate-400" /><input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Search order number, title, narration" className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></div>
              <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="all">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="stopped">Stopped</option></select>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">{selectedIds.length} selected</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left"><button type="button" onClick={toggleSelectAll}>{selectedIds.length === rows.length && rows.length > 0 ? <FaCheck /> : <FaSquare />}</button></th>
                    <th className="px-4 py-3 text-left">Order</th>
                    <th className="px-4 py-3 text-left">Landlord / Property</th>
                    <th className="px-4 py-3 text-left">Schedule</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">Loading standing orders...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">No standing orders found.</td></tr>
                  ) : rows.map((row, index) => (
                    <tr key={row._id} className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-4 py-3"><button type="button" onClick={() => toggleSelect(row._id)}>{selectedIds.includes(row._id) ? <FaCheck className="text-[#0B3B2E]" /> : <FaSquare className="text-slate-400" />}</button></td>
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-900">{row.standingOrderNo}</div>
                        <div className="text-xs text-slate-500">{row.title}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{row.landlord?.landlordName || `${row.landlord?.firstName || ""} ${row.landlord?.lastName || ""}`.trim() || "Landlord"}</div>
                        <div className="text-xs text-slate-500">{row.property?.propertyName || row.property?.name || "No property"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-semibold capitalize">{row.frequency}</div>
                        <div className="text-xs text-slate-500">Next run {row.nextRunDate ? new Date(row.nextRunDate).toLocaleDateString() : "-"}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">KES {Number(row.amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${statusPills[row.status] || statusPills.draft}`}>{row.status}</span></td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-2">
                          <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700"><FaEdit /> Edit</button>
                          {row.status !== "active" && <button onClick={() => handleStatus(row, "active")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><FaPlay /> Activate</button>}
                          {row.status === "active" && <button onClick={() => handleStatus(row, "paused")} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700"><FaPause /> Pause</button>}
                          {row.status !== "stopped" && <button onClick={() => handleStatus(row, "stopped")} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-black text-slate-700"><FaStop /> Stop</button>}
                          <button onClick={() => handleRun(row)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700"><FaCalendarAlt /> Run</button>
                          <button onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700"><FaTrash /> Delete</button>
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
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Landlord Standing Order</p>
                <h3 className="text-xl font-black">{editingId ? "Edit Standing Order" : "Add Standing Order"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              <label className="block"><span className="text-sm font-bold text-slate-700">Landlord</span><select value={form.landlord} onChange={(e) => setForm((prev) => ({ ...prev, landlord: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select landlord</option>{landlords.map((landlord) => <option key={landlord._id} value={landlord._id}>{landlord.landlordName || `${landlord.firstName || ""} ${landlord.lastName || ""}`.trim()}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Property</span><select value={form.property} onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select property</option>{properties.map((property) => <option key={property._id} value={property._id}>{property.propertyCode ? `[${property.propertyCode}] ` : ""}{property.propertyName || property.name}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Amount</span><input type="number" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-2"><span className="text-sm font-bold text-slate-700">Title</span><input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Frequency</span><select value={form.frequency} onChange={(e) => setForm((prev) => ({ ...prev, frequency: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Start Date</span><input type="date" value={form.startDate} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">End Date</span><input type="date" value={form.endDate} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Payment Method</span><select value={form.paymentMethod} onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="bank_transfer">Bank Transfer</option><option value="mpesa">M-Pesa</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Initial Status</span><select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select></label>
              <label className="block xl:col-span-3"><span className="text-sm font-bold text-slate-700">Narration</span><textarea rows={3} value={form.narration} onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white disabled:opacity-60"><FaSave /> {saving ? "Saving..." : editingId ? "Update Order" : "Save Order"}</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default LandlordStandingOrders;
