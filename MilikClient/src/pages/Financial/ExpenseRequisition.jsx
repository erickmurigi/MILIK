import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaCheck, FaClipboardList, FaPlus, FaSyncAlt, FaTrash, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { createExpenseRequisition, deleteExpenseRequisition, listExpenseRequisitions, updateExpenseRequisition } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

const categoryOptions = ["maintenance", "repair", "utility", "tax", "insurance", "supplies", "other"];
const priorityOptions = ["low", "normal", "high", "urgent"];
const statusPill = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  submitted: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  converted: "bg-amber-100 text-amber-700 border-amber-200",
};

const emptyForm = {
  property: "",
  landlord: "",
  title: "",
  category: "maintenance",
  amount: "",
  neededByDate: new Date().toISOString().slice(0, 10),
  priority: "normal",
  status: "draft",
  vendorName: "",
  description: "",
};

const ExpenseRequisition = () => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const businessId = currentCompany?._id || "";
  const [form, setForm] = useState(emptyForm);
  const [rows, setRows] = useState([]);
  const [properties, setProperties] = useState([]);
  const [landlords, setLandlords] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "all", priority: "all" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rowActionKey, setRowActionKey] = useState("");

  const loadData = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [records, propertyRes, landlordRes] = await Promise.all([
        listExpenseRequisitions({ business: businessId, status: filters.status, priority: filters.priority }),
        adminRequests.get(`/properties?business=${businessId}&limit=1000`),
        adminRequests.get(`/landlords?company=${businessId}`),
      ]);
      const propRows = Array.isArray(propertyRes?.data?.data) ? propertyRes.data.data : Array.isArray(propertyRes?.data) ? propertyRes.data : [];
      const landlordRows = Array.isArray(landlordRes?.data?.data) ? landlordRes.data.data : Array.isArray(landlordRes?.data) ? landlordRes.data : [];
      setRows(Array.isArray(records) ? records : []);
      setProperties(propRows);
      setLandlords(landlordRows);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load expense requisitions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessId, filters.status, filters.priority]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const haystack = `${row.referenceNo} ${row.title} ${row.property?.propertyName || ''} ${row.landlord?.landlordName || ''} ${row.vendorName || ''} ${row.description || ''}`.toLowerCase();
      return !filters.search.trim() || haystack.includes(filters.search.trim().toLowerCase());
    });
  }, [rows, filters.search]);

  const stats = useMemo(() => ({
    count: filteredRows.length,
    total: filteredRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    submitted: filteredRows.filter((row) => row.status === 'submitted').length,
    approved: filteredRows.filter((row) => row.status === 'approved').length,
  }), [filteredRows]);

  const saveRecord = async () => {
    if (!businessId) return;
    if (!form.property) return toast.warning('Property is required');
    if (!form.title.trim()) return toast.warning('Title is required');
    if (!form.amount || Number(form.amount) <= 0) return toast.warning('Valid amount is required');
    setSaving(true);
    try {
      const payload = {
        business: businessId,
        property: form.property,
        landlord: form.landlord || undefined,
        title: form.title,
        category: form.category,
        amount: Number(form.amount),
        neededByDate: form.neededByDate || undefined,
        priority: form.priority,
        status: form.status,
        vendorName: form.vendorName,
        description: form.description,
      };
      await createExpenseRequisition(payload);
      toast.success('Expense requisition saved');
      setForm(emptyForm);
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to save expense requisition');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (row, status) => {
    setRowActionKey(`${row._id}:${status}`);
    try {
      await updateExpenseRequisition(row._id, { business: businessId, status, rejectionReason: status === 'rejected' ? 'Rejected from requisition page' : '' });
      toast.success(`Requisition marked ${status}`);
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to update requisition');
    } finally {
      setRowActionKey('');
    }
  };

  const removeRow = async (row) => {
    if (!window.confirm(`Delete requisition ${row.referenceNo || ''}?`)) return;
    setRowActionKey(`${row._id}:delete`);
    try {
      await deleteExpenseRequisition(row._id, { business: businessId });
      toast.success('Requisition deleted');
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to delete requisition');
    } finally {
      setRowActionKey('');
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-3 md:p-5">
        <div className="mx-auto" style={{ maxWidth: '96%' }}>
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-100">Expenses workspace</p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight">Expense Requisition</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">Create internal expense requests first, then move them through submission and approval before they become payment work. This keeps operational requests separate from voucher posting.</p>
                </div>
                <button onClick={loadData} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaSyncAlt className={loading ? 'animate-spin' : ''} /> Refresh</button>
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-white p-4 md:grid-cols-4">
              {[
                { label: 'Visible requests', value: stats.count, accent: 'text-slate-900' },
                { label: 'Requested amount', value: `KES ${stats.total.toLocaleString()}`, accent: 'text-[#0B3B2E]' },
                { label: 'Submitted', value: stats.submitted, accent: 'text-blue-700' },
                { label: 'Approved', value: stats.approved, accent: 'text-emerald-700' },
              ].map((card) => <div key={card.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{card.label}</div><div className={`mt-2 text-2xl font-black ${card.accent}`}>{card.value}</div></div>)}
            </div>

            <div className="grid gap-4 border-b border-slate-200 p-4 xl:grid-cols-[1fr_1.4fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-900"><FaPlus className="text-[#0B3B2E]" /><h2 className="text-lg font-black">New requisition</h2></div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <select value={form.property} onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Select property</option>{properties.map((row) => <option key={row._id} value={row._id}>{row.propertyName || row.name}</option>)}</select>
                  <select value={form.landlord} onChange={(e) => setForm((prev) => ({ ...prev, landlord: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Optional landlord</option>{landlords.map((row) => <option key={row._id} value={row._id}>{row.landlordName || row.name}</option>)}</select>
                  <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Requisition title" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm md:col-span-2" />
                  <select value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">{categoryOptions.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select>
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} placeholder="Amount" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <input type="date" value={form.neededByDate} onChange={(e) => setForm((prev) => ({ ...prev, neededByDate: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <select value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">{priorityOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                  <select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="draft">Draft</option><option value="submitted">Submitted</option></select>
                  <input value={form.vendorName} onChange={(e) => setForm((prev) => ({ ...prev, vendorName: e.target.value }))} placeholder="Suggested vendor" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows={4} placeholder="Operational reason / notes" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm md:col-span-2" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={saveRecord} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-[#0A3127] disabled:opacity-60"><FaCheck /> {saving ? 'Saving...' : 'Save requisition'}</button>
                  <button onClick={() => setForm(emptyForm)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 hover:bg-slate-50"><FaTimes /> Reset</button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
                  <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Search reference, title, property, landlord" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="converted">Converted</option></select>
                  <select value={filters.priority} onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="all">All priorities</option>{priorityOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700"><tr>{['Reference', 'Title', 'Property', 'Amount', 'Priority', 'Status', 'Needed By', 'Actions'].map((header) => <th key={header} className="whitespace-nowrap px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.14em]">{header}</th>)}</tr></thead>
                    <tbody>
                      {filteredRows.length === 0 ? <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-500">No expense requisitions found.</td></tr> : filteredRows.map((row) => (
                        <tr key={row._id} className="border-t border-slate-200 hover:bg-slate-50/80">
                          <td className="px-3 py-3 font-semibold text-slate-900">{row.referenceNo}</td>
                          <td className="px-3 py-3 text-slate-700"><div className="font-semibold">{row.title}</div><div className="text-xs text-slate-500">{row.vendorName || row.description || '-'}</div></td>
                          <td className="px-3 py-3 text-slate-700">{row.property?.propertyName || '-'}</td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900">KES {Number(row.amount || 0).toLocaleString()}</td>
                          <td className="px-3 py-3 text-slate-700 uppercase">{row.priority}</td>
                          <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${statusPill[row.status] || statusPill.draft}`}>{row.status}</span></td>
                          <td className="px-3 py-3 text-slate-700">{row.neededByDate ? new Date(row.neededByDate).toLocaleDateString() : '-'}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.status === 'draft' && <button disabled={rowActionKey === `${row._id}:submitted`} onClick={() => changeStatus(row, 'submitted')} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">Submit</button>}
                              {['draft', 'submitted'].includes(row.status) && <button disabled={rowActionKey === `${row._id}:approved`} onClick={() => changeStatus(row, 'approved')} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">Approve</button>}
                              {row.status !== 'rejected' && row.status !== 'converted' && <button disabled={rowActionKey === `${row._id}:rejected`} onClick={() => changeStatus(row, 'rejected')} className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">Reject</button>}
                              <button disabled={rowActionKey === `${row._id}:delete`} onClick={() => removeRow(row)} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700"><FaTrash /></button>
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
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ExpenseRequisition;
