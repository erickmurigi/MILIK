import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaCalendarAlt, FaPause, FaPlay, FaPlus, FaStop, FaSyncAlt, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { createLandlordStandingOrder, deleteLandlordStandingOrder, listLandlordStandingOrders, updateLandlordStandingOrder } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

const emptyForm = {
  landlord: "",
  property: "",
  title: "",
  amount: "",
  frequency: "monthly",
  dayOfMonth: 5,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  paymentMethod: "bank_transfer",
  destination: { accountName: "", accountNumber: "", bankName: "", branchName: "", mobileNumber: "" },
  narration: "",
  status: "draft",
  notes: "",
};

const statusPill = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  paused: "bg-amber-100 text-amber-700 border-amber-200",
  stopped: "bg-red-100 text-red-700 border-red-200",
};

const LandlordStandingOrders = () => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const businessId = currentCompany?._id || "";
  const [form, setForm] = useState(emptyForm);
  const [rows, setRows] = useState([]);
  const [landlords, setLandlords] = useState([]);
  const [properties, setProperties] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "all", frequency: "all" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rowActionKey, setRowActionKey] = useState("");

  const loadData = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [records, landlordRes, propertyRes] = await Promise.all([
        listLandlordStandingOrders({ business: businessId, status: filters.status, frequency: filters.frequency }),
        adminRequests.get(`/landlords?company=${businessId}`),
        adminRequests.get(`/properties?business=${businessId}&limit=1000`),
      ]);
      const landlordRows = Array.isArray(landlordRes?.data?.data) ? landlordRes.data.data : Array.isArray(landlordRes?.data) ? landlordRes.data : [];
      const propertyRows = Array.isArray(propertyRes?.data?.data) ? propertyRes.data.data : Array.isArray(propertyRes?.data) ? propertyRes.data : [];
      setRows(Array.isArray(records) ? records : []);
      setLandlords(landlordRows);
      setProperties(propertyRows);
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to load landlord standing orders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessId, filters.status, filters.frequency]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const haystack = `${row.referenceNo} ${row.title} ${row.landlord?.landlordName || ''} ${row.property?.propertyName || ''} ${row.narration || ''}`.toLowerCase();
      return !filters.search.trim() || haystack.includes(filters.search.trim().toLowerCase());
    });
  }, [rows, filters.search]);

  const stats = useMemo(() => ({
    count: filteredRows.length,
    active: filteredRows.filter((row) => row.status === 'active').length,
    monthlyAmount: filteredRows.filter((row) => row.status === 'active').reduce((sum, row) => sum + Number(row.amount || 0), 0),
  }), [filteredRows]);

  const saveRecord = async () => {
    if (!businessId) return;
    if (!form.landlord) return toast.warning('Landlord is required');
    if (!form.title.trim()) return toast.warning('Title is required');
    if (!form.amount || Number(form.amount) <= 0) return toast.warning('Valid amount is required');
    setSaving(true);
    try {
      await createLandlordStandingOrder({ ...form, business: businessId, amount: Number(form.amount) });
      toast.success('Standing order saved');
      setForm(emptyForm);
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to save landlord standing order');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (row, status) => {
    setRowActionKey(`${row._id}:${status}`);
    try {
      await updateLandlordStandingOrder(row._id, { business: businessId, status });
      toast.success(`Standing order marked ${status}`);
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to update standing order');
    } finally {
      setRowActionKey('');
    }
  };

  const removeRow = async (row) => {
    if (!window.confirm(`Delete standing order ${row.referenceNo || ''}?`)) return;
    setRowActionKey(`${row._id}:delete`);
    try {
      await deleteLandlordStandingOrder(row._id, { business: businessId });
      toast.success('Standing order deleted');
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to delete standing order');
    } finally {
      setRowActionKey('');
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-3 md:p-5">
        <div className="mx-auto" style={{ maxWidth: '96%' }}>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-100">Landlord payment scheduling</p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight">Landlord Standing Orders</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">Register recurring landlord payment instructions here without auto-posting anything. These instructions stay operational until you intentionally act on them in your normal payment workflow.</p>
                </div>
                <button onClick={loadData} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaSyncAlt className={loading ? 'animate-spin' : ''} /> Refresh</button>
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-white p-4 md:grid-cols-3">
              {[
                { label: 'Visible orders', value: stats.count, accent: 'text-slate-900' },
                { label: 'Active orders', value: stats.active, accent: 'text-emerald-700' },
                { label: 'Active scheduled amount', value: `KES ${stats.monthlyAmount.toLocaleString()}`, accent: 'text-[#0B3B2E]' },
              ].map((card) => <div key={card.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{card.label}</div><div className={`mt-2 text-2xl font-black ${card.accent}`}>{card.value}</div></div>)}
            </div>

            <div className="grid gap-4 border-b border-slate-200 p-4 xl:grid-cols-[1fr_1.35fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-900"><FaPlus className="text-[#0B3B2E]" /><h2 className="text-lg font-black">New standing order</h2></div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <select value={form.landlord} onChange={(e) => setForm((prev) => ({ ...prev, landlord: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Select landlord</option>{landlords.map((row) => <option key={row._id} value={row._id}>{row.landlordName || row.name}</option>)}</select>
                  <select value={form.property} onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Optional property</option>{properties.map((row) => <option key={row._id} value={row._id}>{row.propertyName || row.name}</option>)}</select>
                  <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Instruction title" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm md:col-span-2" />
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} placeholder="Amount" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <select value={form.frequency} onChange={(e) => setForm((prev) => ({ ...prev, frequency: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semi_annually">Semi-annually</option><option value="annually">Annually</option><option value="custom">Custom</option></select>
                  <input type="number" min="1" max="31" value={form.dayOfMonth} onChange={(e) => setForm((prev) => ({ ...prev, dayOfMonth: e.target.value }))} placeholder="Day of month" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <input type="date" value={form.startDate} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <input type="date" value={form.endDate} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <select value={form.paymentMethod} onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="bank_transfer">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option><option value="check">Cheque</option></select>
                  <select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select>
                  <input value={form.destination.bankName} onChange={(e) => setForm((prev) => ({ ...prev, destination: { ...prev.destination, bankName: e.target.value } }))} placeholder="Bank / destination name" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <input value={form.destination.accountNumber} onChange={(e) => setForm((prev) => ({ ...prev, destination: { ...prev.destination, accountNumber: e.target.value } }))} placeholder="Account / till / wallet number" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <input value={form.destination.accountName} onChange={(e) => setForm((prev) => ({ ...prev, destination: { ...prev.destination, accountName: e.target.value } }))} placeholder="Account name" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <input value={form.destination.mobileNumber} onChange={(e) => setForm((prev) => ({ ...prev, destination: { ...prev.destination, mobileNumber: e.target.value } }))} placeholder="Mobile number" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <input value={form.narration} onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))} placeholder="Narration" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm md:col-span-2" />
                  <textarea rows={3} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Operational notes" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm md:col-span-2" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={saveRecord} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-[#0A3127] disabled:opacity-60"><FaCalendarAlt /> {saving ? 'Saving...' : 'Save standing order'}</button>
                  <button onClick={() => setForm(emptyForm)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 hover:bg-slate-50">Reset</button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
                  <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Search reference, title, landlord, property" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="all">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="stopped">Stopped</option></select>
                  <select value={filters.frequency} onChange={(e) => setFilters((prev) => ({ ...prev, frequency: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="all">All frequencies</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semi_annually">Semi-annually</option><option value="annually">Annually</option><option value="custom">Custom</option></select>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700"><tr>{['Reference', 'Title', 'Landlord', 'Amount', 'Frequency', 'Next Run', 'Status', 'Actions'].map((header) => <th key={header} className="whitespace-nowrap px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.14em]">{header}</th>)}</tr></thead>
                    <tbody>
                      {filteredRows.length === 0 ? <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-500">No landlord standing orders found.</td></tr> : filteredRows.map((row) => (
                        <tr key={row._id} className="border-t border-slate-200 hover:bg-slate-50/80">
                          <td className="px-3 py-3 font-semibold text-slate-900">{row.referenceNo}</td>
                          <td className="px-3 py-3 text-slate-700"><div className="font-semibold">{row.title}</div><div className="text-xs text-slate-500">{row.property?.propertyName || row.narration || '-'}</div></td>
                          <td className="px-3 py-3 text-slate-700">{row.landlord?.landlordName || '-'}</td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900">KES {Number(row.amount || 0).toLocaleString()}</td>
                          <td className="px-3 py-3 text-slate-700 uppercase">{String(row.frequency || '').replace(/_/g, ' ')}</td>
                          <td className="px-3 py-3 text-slate-700">{row.nextRunDate ? new Date(row.nextRunDate).toLocaleDateString() : '-'}</td>
                          <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${statusPill[row.status] || statusPill.draft}`}>{row.status}</span></td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.status !== 'active' && <button disabled={rowActionKey === `${row._id}:active`} onClick={() => changeStatus(row, 'active')} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700"><FaPlay /></button>}
                              {row.status === 'active' && <button disabled={rowActionKey === `${row._id}:paused`} onClick={() => changeStatus(row, 'paused')} className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700"><FaPause /></button>}
                              {row.status !== 'stopped' && <button disabled={rowActionKey === `${row._id}:stopped`} onClick={() => changeStatus(row, 'stopped')} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700"><FaStop /></button>}
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

export default LandlordStandingOrders;
