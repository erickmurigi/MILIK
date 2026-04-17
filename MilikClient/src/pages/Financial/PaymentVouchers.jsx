import React, { useEffect, useMemo, useState } from "react";
import {
  FaCheck,
  FaEdit,
  FaFileInvoiceDollar,
  FaFilter,
  FaPlus,
  FaSave,
  FaSearch,
  FaSquare,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { useLocation, useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { hasCompanyPermission } from "../../utils/permissions";
import {
  createPaymentVoucher,
  deletePaymentVoucher,
  getChartOfAccounts,
  getPaymentVouchers,
  updatePaymentVoucher,
  updatePaymentVoucherStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";

const BASE_CATEGORIES = [
  { value: "landlord_maintenance", label: "Landlord Expense - Maintenance", landlordLabel: "Owner Expense - Maintenance" },
  { value: "deposit_refund", label: "Deposit Refund", landlordLabel: "Deposit Refund" },
  { value: "landlord_other", label: "Landlord Expense - Other", landlordLabel: "Owner Expense - Other" },
];

const statusColors = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  approved: "bg-blue-100 text-blue-700 border-blue-200",
  paid: "bg-green-100 text-green-700 border-green-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
};

const blankForm = {
  category: "landlord_maintenance",
  propertyId: "",
  liabilityAccountId: "",
  amount: "",
  dueDate: new Date().toISOString().split("T")[0],
  narration: "",
  status: "draft",
  reference: "",
  sourceRequisitionId: "",
  sourceRequisitionNo: "",
};

const PaymentVouchers = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const properties = useSelector((state) => state.property?.properties || []);
  const isLandlordWorkspace = useMemo(
    () => isSelfManagingLandlordCompany(currentCompany || currentUser?.company || null),
    [currentCompany, currentUser?.company]
  );
  const categories = useMemo(
    () => BASE_CATEGORIES.map((category) => ({
      ...category,
      label: isLandlordWorkspace ? category.landlordLabel : category.label,
    })),
    [isLandlordWorkspace]
  );

  const canCreateVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "create", "accounts");
  const canUpdateVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "update", "accounts");
  const canApproveVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "approve", "accounts");
  const canReverseVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "reverse", "accounts");
  const canDeleteVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "delete", "accounts");

  const [filters, setFilters] = useState({ search: "", category: "all", status: "all", propertyId: "all" });
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowActionKey, setRowActionKey] = useState("");
  const [liabilityAccounts, setLiabilityAccounts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingVoucherId, setEditingVoucherId] = useState("");
  const [form, setForm] = useState(blankForm);

  const normalizeVoucher = (voucher) => ({
    ...voucher,
    propertyId: voucher?.property?._id || voucher?.property || voucher?.propertyId || "",
    propertyName: voucher?.property?.propertyName || voucher?.property?.name || voucher?.propertyName || "N/A",
    landlordName: voucher?.landlord?.landlordName || voucher?.landlord?.name || voucher?.landlordName || "N/A",
    liabilityAccountId: voucher?.liabilityAccount?._id || voucher?.liabilityAccount || voucher?.liabilityAccountId || "",
    liabilityAccountName: voucher?.liabilityAccount?.name || voucher?.liabilityAccountName || "N/A",
    sourceRequisitionId: voucher?.sourceRequisition?._id || voucher?.sourceRequisition || voucher?.sourceRequisitionId || "",
    sourceRequisitionNo: voucher?.sourceRequisition?.requisitionNo || voucher?.sourceRequisition?.referenceNo || voucher?.sourceRequisitionNo || "",
  });

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  useEffect(() => {
    if (!location.state) return;

    const { openCreate, prefill, search } = location.state || {};

    if (search) {
      setFilters((prev) => ({ ...prev, search: String(search || "") }));
    }

    if (openCreate && prefill) {
      setEditingVoucherId("");
      setForm({
        ...blankForm,
        ...prefill,
      });
      setShowModal(true);
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    const loadLiabilityAccounts = async () => {
      if (!currentCompany?._id) return;
      try {
        const rows = await getChartOfAccounts({ business: currentCompany._id, type: "liability" });
        setLiabilityAccounts(Array.isArray(rows) ? rows.filter((row) => row?.isPosting !== false) : []);
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to load liability accounts");
      }
    };
    loadLiabilityAccounts();
  }, [currentCompany?._id]);

  const loadVouchers = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const rows = await getPaymentVouchers({ ...filters, business: currentCompany._id, company: currentCompany._id });
      setVouchers((Array.isArray(rows) ? rows : []).map(normalizeVoucher));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load payment vouchers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVouchers();
  }, [currentCompany?._id, filters.search, filters.category, filters.status, filters.propertyId]);

  const filtered = useMemo(() => vouchers, [vouchers]);

  const stats = useMemo(() => {
    const total = filtered.reduce((sum, voucher) => sum + Number(voucher.amount || 0), 0);
    const paid = filtered.filter((voucher) => voucher.status === "paid").reduce((sum, voucher) => sum + Number(voucher.amount || 0), 0);
    const draft = filtered.filter((voucher) => voucher.status === "draft").length;
    return { count: filtered.length, total, paid, draft };
  }, [filtered]);

  const selectedRows = useMemo(() => filtered.filter((voucher) => selectedIds.includes(voucher._id)), [filtered, selectedIds]);

  const openCreate = (prefill = null) => {
    setEditingVoucherId("");
    setForm(prefill ? { ...blankForm, ...prefill } : blankForm);
    setShowModal(true);
  };

  const openEdit = (voucher) => {
    setEditingVoucherId(voucher._id);
    setForm({
      category: voucher.category || "landlord_maintenance",
      propertyId: voucher.propertyId || "",
      liabilityAccountId: voucher.liabilityAccountId || "",
      amount: voucher.amount || "",
      dueDate: voucher.dueDate ? new Date(voucher.dueDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      narration: voucher.narration || "",
      status: voucher.status || "draft",
      reference: voucher.reference || "",
      sourceRequisitionId: voucher.sourceRequisitionId || "",
      sourceRequisitionNo: voucher.sourceRequisitionNo || "",
    });
    setShowModal(true);
  };

  const validateForm = () => {
    if (!form.propertyId) return "Property is required";
    if (!form.liabilityAccountId) return "Credit liability posting account is required";
    if (!form.amount || Number(form.amount) <= 0) return "Valid amount is required";
    return "";
  };

  const handleSave = async () => {
    const errorMessage = validateForm();
    if (errorMessage) {
      toast.warning(errorMessage);
      return;
    }

    const payload = {
      business: currentCompany?._id,
      company: currentCompany?._id,
      category: form.category,
      property: form.propertyId,
      liabilityAccount: form.liabilityAccountId,
      amount: Number(form.amount),
      dueDate: form.dueDate,
      narration: form.narration,
      status: form.status,
      reference: form.reference || undefined,
      sourceRequisition: form.sourceRequisitionId || undefined,
    };

    setSaving(true);
    try {
      const saved = editingVoucherId
        ? await updatePaymentVoucher(editingVoucherId, payload, { business: currentCompany?._id, company: currentCompany?._id })
        : await createPaymentVoucher(payload);
      const normalized = normalizeVoucher(saved);
      setVouchers((prev) => editingVoucherId ? prev.map((row) => row._id === editingVoucherId ? normalized : row) : [normalized, ...prev]);
      setShowModal(false);
      setEditingVoucherId("");
      setForm(blankForm);
      toast.success(`Voucher ${editingVoucherId ? "updated" : "saved"} successfully`);
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to ${editingVoucherId ? "update" : "save"} payment voucher`);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id, status) => {
    setRowActionKey(`${id}:${status}`);
    try {
      const updated = await updatePaymentVoucherStatus(id, { status }, { business: currentCompany?._id, company: currentCompany?._id });
      setVouchers((prev) => prev.map((voucher) => voucher._id === id ? normalizeVoucher(updated) : voucher));
      toast.success(`Voucher marked ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update voucher status");
    } finally {
      setRowActionKey("");
    }
  };

  const removeVoucher = async (voucher) => {
    if (!window.confirm(`Delete voucher ${voucher?.voucherNo || ""}?`)) return;
    setRowActionKey(`${voucher._id}:delete`);
    try {
      await deletePaymentVoucher(voucher._id, { business: currentCompany?._id, company: currentCompany?._id });
      setVouchers((prev) => prev.filter((row) => row._id !== voucher._id));
      setSelectedIds((prev) => prev.filter((id) => id !== voucher._id));
      toast.success("Voucher deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete voucher");
    } finally {
      setRowActionKey("");
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelectedIds((prev) => prev.length === filtered.length ? [] : filtered.map((voucher) => voucher._id));

  const bulkDeleteSelected = async () => {
    if (selectedRows.length === 0) return toast.info("Select vouchers first");
    if (!window.confirm(`Delete ${selectedRows.length} selected vouchers?`)) return;
    for (const voucher of selectedRows) {
      // eslint-disable-next-line no-await-in-loop
      await deletePaymentVoucher(voucher._id, { business: currentCompany?._id, company: currentCompany?._id }).catch(() => null);
    }
    await loadVouchers();
    setSelectedIds([]);
    toast.success("Selected vouchers deleted where allowed");
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
        <div className="mx-auto max-w-[96%] space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">{isLandlordWorkspace ? "Owner Finance" : "Financial Operations"}</p>
                <h1 className="mt-1 flex items-center gap-3 text-2xl font-black text-slate-900"><FaFileInvoiceDollar className="text-[#0B3B2E]" /> Payment Vouchers</h1>
                <p className="mt-1 text-sm text-slate-500">Create, edit, approve, pay, reverse, select, and delete vouchers with stronger operational controls.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={bulkDeleteSelected} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">Delete Selected</button>
                <button onClick={openCreate} disabled={!canCreateVoucher} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white hover:bg-[#0A3127] disabled:opacity-60"><FaPlus /> New Voucher</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Count</p><p className="mt-2 text-2xl font-black text-slate-900">{stats.count}</p></div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Total</p><p className="mt-2 text-2xl font-black text-blue-700">KES {stats.total.toLocaleString()}</p></div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Paid</p><p className="mt-2 text-2xl font-black text-emerald-700">KES {stats.paid.toLocaleString()}</p></div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-600">Draft</p><p className="mt-2 text-2xl font-black text-amber-700">{stats.draft}</p></div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
              <div className="relative md:col-span-2">
                <FaSearch className="absolute left-3 top-2.5 text-xs text-slate-400" />
                <input
                  value={filters.search}
                  onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder={isLandlordWorkspace ? "Search voucher, narration, owner, property" : "Search voucher, narration, landlord, property"}
                  className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-xs"
                />
              </div>

              <select
                value={filters.category}
                onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
                className="px-3 py-2 text-xs border border-slate-300 rounded-md"
              >
                <option value="all">All categories</option>
                {categories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="px-3 py-2 text-xs border border-slate-300 rounded-md"
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="reversed">Reversed</option>
              </select>

              <select
                value={filters.propertyId}
                onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))}
                className="px-3 py-2 text-xs border border-slate-300 rounded-md"
              >
                <option value="all">All properties</option>
                {properties.map((property) => (
                  <option key={property._id} value={property._id}>
                    {property.propertyName || property.name}
                  </option>
                ))}
              </select>

              <button
                onClick={() => setFilters({ search: "", category: "all", status: "all", propertyId: "all" })}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <FaFilter /> Reset
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left"><button type="button" onClick={toggleSelectAll}>{selectedIds.length === filtered.length && filtered.length > 0 ? <FaCheck /> : <FaSquare />}</button></th>
                    <th className="px-4 py-3 text-left">Voucher</th>
                    <th className="px-4 py-3 text-left">Category</th>
                    <th className="px-4 py-3 text-left">Property</th>
                    <th className="px-4 py-3 text-left">{isLandlordWorkspace ? "Owner" : "Landlord"}</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Due Date</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="9" className="px-4 py-10 text-center text-slate-500">Loading vouchers...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan="9" className="px-4 py-10 text-center text-slate-500">No payment vouchers found.</td></tr>
                  ) : filtered.map((voucher, index) => {
                    const isBusy = (action) => rowActionKey === `${voucher._id}:${action}`;
                    return (
                      <tr key={voucher._id} className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                        <td className="px-4 py-3"><button type="button" onClick={() => toggleSelect(voucher._id)}>{selectedIds.includes(voucher._id) ? <FaCheck className="text-[#0B3B2E]" /> : <FaSquare className="text-slate-400" />}</button></td>
                        <td className="px-4 py-3"><div className="font-black text-slate-900">{voucher.voucherNo}</div><div className="text-xs text-slate-500">{voucher.reference || voucher.narration || "No reference"}</div></td>
                        <td className="px-4 py-3 text-slate-700">{categories.find((item) => item.value === voucher.category)?.label || voucher.category}</td>
                        <td className="px-4 py-3 text-slate-700">{voucher.propertyName}</td>
                        <td className="px-4 py-3 text-slate-700">{voucher.landlordName}</td>
                        <td className="px-4 py-3 text-right font-black text-slate-900">KES {Number(voucher.amount || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-slate-700">{voucher.dueDate ? new Date(voucher.dueDate).toLocaleDateString() : "-"}</td>
                        <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusColors[voucher.status] || statusColors.draft}`}>{voucher.status}</span></td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-2">
                            {voucher.status === "draft" && canUpdateVoucher && <button onClick={() => openEdit(voucher)} className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700"><FaEdit /> Edit</button>}
                            {voucher.status === "draft" && canApproveVoucher && <button onClick={() => updateStatus(voucher._id, "approved")} disabled={!!rowActionKey} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 disabled:opacity-60"><FaCheck /> {isBusy("approved") ? "Working..." : "Approve"}</button>}
                            {(voucher.status === "draft" || voucher.status === "approved") && canUpdateVoucher && <button onClick={() => updateStatus(voucher._id, "paid")} disabled={!!rowActionKey} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 disabled:opacity-60"><FaCheck /> {isBusy("paid") ? "Working..." : "Mark Paid"}</button>}
                            {voucher.status !== "reversed" && canReverseVoucher && <button onClick={() => updateStatus(voucher._id, "reversed")} disabled={!!rowActionKey} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 disabled:opacity-60"><FaUndo /> {isBusy("reversed") ? "Working..." : "Reverse"}</button>}
                            {canDeleteVoucher && <button onClick={() => removeVoucher(voucher)} disabled={!!rowActionKey} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-60"><FaTrash /> {isBusy("delete") ? "Working..." : "Delete"}</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4 sm:items-center sm:p-6">
          <div className="flex w-full max-w-4xl max-h-[calc(100vh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Payment Voucher</p>
                <h3 className="text-xl font-black">{editingVoucherId ? "Edit Voucher" : "New Voucher"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10">×</button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              {form.sourceRequisitionNo ? (
                <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
                  <span className="font-black uppercase tracking-[0.16em] text-violet-700">Source Requisition</span>
                  <div className="mt-1 font-bold">{form.sourceRequisitionNo}</div>
                  <div className="mt-1 text-xs text-violet-700">This voucher will keep the requisition linked and mark it as converted.</div>
                </div>
              ) : null}
              <label className="block"><span className="text-sm font-bold text-slate-700">Category</span><select value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20">{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Property</span><select value={form.propertyId} onChange={(e) => setForm((prev) => ({ ...prev, propertyId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select property</option>{properties.map((property) => <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Liability Account</span><select value={form.liabilityAccountId} onChange={(e) => setForm((prev) => ({ ...prev, liabilityAccountId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select liability account</option>{liabilityAccounts.map((account) => <option key={account._id} value={account._id}>{account.code} - {account.name}</option>)}</select></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Amount</span><input type="number" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Due Date</span><input type="date" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              {!editingVoucherId && <label className="block"><span className="text-sm font-bold text-slate-700">Initial Status</span><select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="draft">Draft</option><option value="approved">Approved</option><option value="paid">Paid</option></select></label>}
              <label className="block xl:col-span-3"><span className="text-sm font-bold text-slate-700">Reference</span><input value={form.reference} onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-3"><span className="text-sm font-bold text-slate-700">Narration</span><textarea rows={3} value={form.narration} onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
            </div>
            <div className="sticky bottom-0 z-20 flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving || (editingVoucherId ? !canUpdateVoucher : !canCreateVoucher)} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-black text-white disabled:opacity-60"><FaSave /> {saving ? "Saving..." : editingVoucherId ? "Update Voucher" : "Save Voucher"}</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default PaymentVouchers;
