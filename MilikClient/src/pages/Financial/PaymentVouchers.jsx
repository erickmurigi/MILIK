import React, { useEffect, useMemo, useState } from "react";
import { FaCheck, FaFileInvoiceDollar, FaFilter, FaPlus, FaRedoAlt, FaSearch, FaTrash, FaUndo } from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { hasCompanyPermission } from "../../utils/permissions";
import {
  createPaymentVoucher,
  deletePaymentVoucher,
  getChartOfAccounts,
  getLandlords,
  getPaymentVouchers,
  updatePaymentVoucherStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";

const categories = [
  { value: "landlord_maintenance", label: "Landlord Expense - Maintenance" },
  { value: "deposit_refund", label: "Deposit Refund" },
  { value: "landlord_other", label: "Landlord Expense - Other" },
];

const statusColors = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  approved: "bg-blue-100 text-blue-700 border-blue-200",
  paid: "bg-green-100 text-green-700 border-green-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
};

const PaymentVouchers = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const canCreateVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "create", "accounts");
  const canUpdateVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "update", "accounts");
  const canApproveVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "approve", "accounts");
  const canReverseVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "reverse", "accounts");
  const canDeleteVoucher = hasCompanyPermission(currentUser || {}, currentCompany, "paymentVouchers", "delete", "accounts");
  const properties = useSelector((state) => state.property?.properties || []);
  const landlords = useSelector((state) => state.landlord?.landlords || []);

  const [filters, setFilters] = useState({
    search: "",
    category: "all",
    status: "all",
    propertyId: "all",
  });
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rowActionKey, setRowActionKey] = useState("");
  const [liabilityAccounts, setLiabilityAccounts] = useState([]);

  const [form, setForm] = useState({
    category: "landlord_maintenance",
    propertyId: "",
    landlordId: "",
    liabilityAccountId: "",
    amount: "",
    dueDate: new Date().toISOString().split("T")[0],
    narration: "",
    status: "draft",
    reference: "",
  });

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
    dispatch(getLandlords({ company: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  useEffect(() => {
    const loadLiabilityAccounts = async () => {
      if (!currentCompany?._id) return;
      try {
        const rows = await getChartOfAccounts({
          business: currentCompany._id,
          type: "liability",
        });
        setLiabilityAccounts(Array.isArray(rows) ? rows.filter((row) => row?.isPosting !== false) : []);
      } catch (error) {
        console.error("Failed to load chart of accounts", error);
        toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to load liability accounts");
      }
    };

    loadLiabilityAccounts();
  }, [currentCompany?._id]);

  const normalizeVoucher = (voucher) => ({
    ...voucher,
    propertyId: voucher?.property?._id || voucher?.property || voucher?.propertyId || "",
    propertyName:
      voucher?.property?.propertyName ||
      voucher?.property?.name ||
      voucher?.propertyName ||
      "N/A",
    landlordId: voucher?.landlord?._id || voucher?.landlord || voucher?.landlordId || "",
    landlordName:
      voucher?.landlord?.landlordName ||
      voucher?.landlord?.name ||
      voucher?.landlordName ||
      "N/A",
    liabilityAccountId:
      voucher?.liabilityAccount?._id || voucher?.liabilityAccount || voucher?.liabilityAccountId || "",
    liabilityAccountName:
      voucher?.liabilityAccount?.name ||
      voucher?.liabilityAccountName ||
      "N/A",
  });

  const loadVouchers = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const rows = await getPaymentVouchers({
        ...filters,
        business: currentCompany._id,
        company: currentCompany._id,
      });
      setVouchers((rows || []).map(normalizeVoucher));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load payment vouchers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVouchers();
  }, [currentCompany?._id, filters]);

  const filtered = useMemo(() => {
    return vouchers.filter((voucher) => {
      const haystack = `${voucher.voucherNo} ${voucher.reference} ${voucher.narration} ${voucher.landlordName} ${voucher.propertyName} ${voucher.liabilityAccountName}`.toLowerCase();
      const term = filters.search.trim().toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (filters.category !== "all" && voucher.category !== filters.category) return false;
      if (filters.status !== "all" && voucher.status !== filters.status) return false;
      if (filters.propertyId !== "all" && voucher.propertyId !== filters.propertyId) return false;
      return true;
    });
  }, [vouchers, filters]);

  const stats = useMemo(() => {
    const total = filtered.reduce((sum, v) => sum + Number(v.amount || 0), 0);
    const paid = filtered.filter((v) => v.status === "paid").reduce((sum, v) => sum + Number(v.amount || 0), 0);
    return { count: filtered.length, total, paid };
  }, [filtered]);

  const createVoucher = async () => {
    if (!form.propertyId) {
      toast.warning("Property is required");
      return;
    }

    if (!form.liabilityAccountId) {
      toast.warning("Credit liability posting account is required");
      return;
    }

    if (!form.amount || Number(form.amount) <= 0) {
      toast.warning("Valid amount is required");
      return;
    }

    if (form.category === "deposit_refund") {
      const property = properties.find((p) => p._id === form.propertyId);
      if (!property) {
        toast.warning("Select a valid property for the deposit refund voucher.");
        return;
      }
    }

    const payload = {
      business: currentCompany?._id,
      company: currentCompany?._id,
      category: form.category,
      property: form.propertyId,
      landlord: form.landlordId || undefined,
      liabilityAccount: form.liabilityAccountId,
      amount: Number(form.amount),
      dueDate: form.dueDate,
      narration: form.narration,
      status: form.status,
      reference: form.reference || undefined,
    };

    try {
      const saved = await createPaymentVoucher(payload);
      setVouchers((prev) => [normalizeVoucher(saved), ...prev]);
      setForm((prev) => ({
        ...prev,
        landlordId: "",
        amount: "",
        narration: "",
        reference: "",
        status: "draft",
      }));
      toast.success(`Voucher ${saved?.voucherNo || "created"} saved`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save payment voucher");
    }
  };

  const updateStatus = async (id, status) => {
    setRowActionKey(`${id}:${status}`);
    try {
      const updated = await updatePaymentVoucherStatus(
        id,
        { status },
        { business: currentCompany?._id, company: currentCompany?._id }
      );
      setVouchers((prev) => prev.map((v) => (v._id === id ? normalizeVoucher(updated) : v)));
      toast.success(`Voucher marked ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update voucher status");
    } finally {
      setRowActionKey("");
    }
  };

  const removeVoucher = async (voucher) => {
    const ok = window.confirm(`Delete voucher ${voucher?.voucherNo || ""}? This cannot be undone.`);
    if (!ok) return;

    setRowActionKey(`${voucher._id}:delete`);
    try {
      await deletePaymentVoucher(voucher._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setVouchers((prev) => prev.filter((row) => row._id !== voucher._id));
      toast.success("Voucher deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete voucher");
    } finally {
      setRowActionKey("");
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-3">
        <div className="mx-auto" style={{ maxWidth: "96%" }}>
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-2.5 mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <FaFileInvoiceDollar /> Payment Vouchers
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded border border-slate-300 bg-slate-50 font-semibold">Count: {stats.count}</span>
                <span className="px-2 py-0.5 rounded border border-blue-300 bg-blue-50 font-semibold text-blue-700">Total: Ksh {stats.total.toLocaleString()}</span>
                <span className="px-2 py-0.5 rounded border border-green-300 bg-green-50 font-semibold text-green-700">Paid: Ksh {stats.paid.toLocaleString()}</span>
                <button
                  onClick={loadVouchers}
                  className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-semibold inline-flex items-center gap-1"
                >
                  <FaRedoAlt size={10} /> Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
            <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg shadow-sm p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase">
                <FaPlus /> New Voucher
              </div>

              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>

              <select
                value={form.propertyId}
                onChange={(e) => setForm((prev) => ({ ...prev, propertyId: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              >
                <option value="">Select Property</option>
                {properties.map((p) => (
                  <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>
                ))}
              </select>

              <select
                value={form.landlordId}
                onChange={(e) => setForm((prev) => ({ ...prev, landlordId: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              >
                <option value="">Select Landlord (optional)</option>
                {landlords.map((l) => (
                  <option key={l._id} value={l._id}>{l.landlordName || l.name || "Landlord"}</option>
                ))}
              </select>

              <select
                value={form.liabilityAccountId}
                onChange={(e) => setForm((prev) => ({ ...prev, liabilityAccountId: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              >
                <option value="">Select Credit Liability Account</option>
                {liabilityAccounts.map((account) => (
                  <option key={account._id} value={account._id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="0"
                  placeholder="Amount"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                />
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                />
              </div>

              <input
                placeholder="Reference (optional)"
                value={form.reference}
                onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              />

              <textarea
                rows={2}
                placeholder="Narration"
                value={form.narration}
                onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
              />

              <button
                onClick={createVoucher}
                disabled={!canCreateVoucher}
                className="w-full px-3 py-2 text-xs rounded text-white font-semibold bg-[#0B3B2E] hover:bg-[#0A3127]"
              >
                Save Payment Voucher
              </button>
            </div>

            <div className="xl:col-span-3 bg-white border border-slate-200 rounded-lg shadow-sm p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="relative flex-1 min-w-[180px]">
                  <FaSearch className="absolute left-2 top-2.5 text-[10px] text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search voucher, narration, landlord"
                    className="w-full pl-7 pr-2 py-2 text-xs border border-slate-300 rounded"
                  />
                </div>

                <select
                  value={filters.category}
                  onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
                  className="px-2 py-2 text-xs border border-slate-300 rounded"
                >
                  <option value="all">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>

                <select
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className="px-2 py-2 text-xs border border-slate-300 rounded"
                >
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                  <option value="reversed">Reversed</option>
                </select>

                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))}
                  className="px-2 py-2 text-xs border border-slate-300 rounded"
                >
                  <option value="all">All Properties</option>
                  {properties.map((p) => (
                    <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>
                  ))}
                </select>

                <button
                  onClick={() => setFilters({ search: "", category: "all", status: "all", propertyId: "all" })}
                  className="px-2 py-2 text-xs border border-slate-300 rounded text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                >
                  <FaFilter /> Reset
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-2 py-1 text-left">Voucher</th>
                      <th className="px-2 py-1 text-left">Category</th>
                      <th className="px-2 py-1 text-left">Property</th>
                      <th className="px-2 py-1 text-left">Landlord</th>
                      <th className="px-2 py-1 text-right">Amount</th>
                      <th className="px-2 py-1 text-left">Due</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="px-2 py-6 text-center text-slate-500">Loading vouchers...</td>
                      </tr>
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-2 py-6 text-center text-slate-500">No payment vouchers yet.</td>
                      </tr>
                    ) : (
                      filtered.map((v) => {
                        const isBusy = (action) => rowActionKey === `${v._id}:${action}`;
                        return (
                          <tr key={v._id} className="border-b border-slate-200 hover:bg-slate-50">
                            <td className="px-2 py-1.5 font-bold text-slate-900">{v.voucherNo}</td>
                            <td className="px-2 py-1.5">{categories.find((c) => c.value === v.category)?.label || v.category}</td>
                            <td className="px-2 py-1.5">{v.propertyName}</td>
                            <td className="px-2 py-1.5">{v.landlordName}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">{Number(v.amount || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5">{v.dueDate ? new Date(v.dueDate).toLocaleDateString() : "-"}</td>
                            <td className="px-2 py-1.5">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColors[v.status] || statusColors.draft}`}>
                                {v.status}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex flex-wrap gap-1">
                                {v.status === "draft" && canApproveVoucher && (
                                  <button
                                    onClick={() => updateStatus(v._id, "approved")}
                                    disabled={!!rowActionKey}
                                    className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 disabled:opacity-60"
                                  >
                                    <FaCheck size={10} /> {isBusy("approved") ? "Working..." : "Approve"}
                                  </button>
                                )}

                                {(v.status === "draft" || v.status === "approved") && canUpdateVoucher && (
                                  <button
                                    onClick={() => updateStatus(v._id, "paid")}
                                    disabled={!!rowActionKey}
                                    className="inline-flex items-center gap-1 rounded border border-green-300 bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 disabled:opacity-60"
                                  >
                                    <FaCheck size={10} /> {isBusy("paid") ? "Working..." : "Mark Paid"}
                                  </button>
                                )}

                                {v.status !== "reversed" && canReverseVoucher && (
                                  <button
                                    onClick={() => {
                                      const ok = window.confirm(`Reverse voucher ${v.voucherNo}?`);
                                      if (!ok) return;
                                      updateStatus(v._id, "reversed");
                                    }}
                                    disabled={!!rowActionKey}
                                    className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 disabled:opacity-60"
                                  >
                                    <FaUndo size={10} /> {isBusy("reversed") ? "Working..." : "Reverse"}
                                  </button>
                                )}

                                {canDeleteVoucher && (<button
                                  onClick={() => removeVoucher(v)}
                                  disabled={!!rowActionKey}
                                  className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                                >
                                  <FaTrash size={10} /> {isBusy("delete") ? "Working..." : "Delete"}
                                </button>)}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PaymentVouchers;