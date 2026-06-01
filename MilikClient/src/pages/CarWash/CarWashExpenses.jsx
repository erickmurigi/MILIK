import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaChevronDown, FaChevronRight, FaPlus, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const PAGE_SIZE = 30;
const methods = ["cash", "mpesa", "bank", "card", "other"];
const statuses = ["draft", "approved", "paid", "cancelled"];
const categories = ["Supplies", "Staff Wages", "Water and Utilities", "Equipment Repair", "Rent", "Other"];
const defaultFilters = { date: todayISO(), status: "", category: "", method: "", cashbookAccount: "", search: "" };
const emptyForm = {
  expenseDate: todayISO(),
  payee: "",
  category: "Supplies",
  description: "",
  amount: "",
  method: "cash",
  cashbookAccount: "",
  reference: "",
  status: "paid",
  notes: "",
};
const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const statusBadgeClass = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  approved: "border-cyan-200 bg-cyan-50 text-cyan-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const preferredCashbookForMethod = (cashbooks = [], method = "cash") => {
  const haystack = (item) => `${item?.name || ""} ${item?.code || ""}`.toLowerCase();
  if (method === "mpesa") return cashbooks.find((item) => /m-?pesa|mpesa/.test(haystack(item)))?._id || "";
  if (method === "bank" || method === "card") return cashbooks.find((item) => /bank/.test(haystack(item)))?._id || "";
  if (method === "cash") return cashbooks.find((item) => /cash|hand|safe/.test(haystack(item)))?._id || "";
  return cashbooks[0]?._id || "";
};

const statusOptionsFor = (status = "draft") => {
  if (status === "paid") return ["paid"];
  if (status === "cancelled") return ["cancelled"];
  if (status === "approved") return ["approved", "paid", "cancelled"];
  return statuses;
};

const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-3xl border border-slate-200 bg-white shadow-2xl">
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

const CarWashExpenses = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const isConsolidated = !getActiveBranchId();
  const [rows, setRows] = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [form, setForm] = useState(emptyForm);
  const [expandedIds, setExpandedIds] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [summary, setSummary] = useState({ draft: {}, approved: {}, paid: {}, cancelled: {}, totalAmount: 0, totalCount: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listExpenses({ ...appliedFilters, limit: PAGE_SIZE, page });
      const expenses = normalizeListPayload(payload, "expenses");
      setRows(expenses);
      setPagination(payload?.pagination || { page, limit: PAGE_SIZE, total: expenses.length, pages: 1 });
      setSummary(payload?.summary || { draft: {}, approved: {}, paid: {}, cancelled: {}, totalAmount: 0, totalCount: 0 });
      setExpandedIds([]);
    } catch {
      toast.error("Failed to load Car Wash expenses");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const loadCashbooks = useCallback(async () => {
    if (!currentCompany?._id) return;
    try {
      const accounts = await carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" });
      const options = (Array.isArray(accounts) ? accounts : []).filter((account) =>
        String(account?.subGroup || "").toLowerCase().includes("cashbook") && account.isPosting !== false
      );
      setCashbooks(options);
      setForm((prev) => (prev.cashbookAccount || !options[0]?._id ? prev : { ...prev, cashbookAccount: preferredCashbookForMethod(options, prev.method) }));
    } catch {
      toast.error("Failed to load expense cashbooks");
    }
  }, [currentCompany?._id]);

  useEffect(() => {
    loadCashbooks();
  }, [loadCashbooks]);

  const pageTotal = useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), [rows]);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setPage(1);
    setAppliedFilters(defaultFilters);
  };

  const closeModal = () => {
    setShowModal(false);
    setForm({ ...emptyForm, cashbookAccount: preferredCashbookForMethod(cashbooks, emptyForm.method) });
  };

  const openModal = () => {
    setForm((prev) => ({ ...prev, cashbookAccount: prev.cashbookAccount || preferredCashbookForMethod(cashbooks, prev.method) }));
    setShowModal(true);
  };

  const createExpense = async (event) => {
    event.preventDefault();
    try {
      if (form.status === "paid" && !form.cashbookAccount) {
        toast.error("Select the cashbook where this expense was paid from");
        return;
      }
      await carWashApi.createExpense({ ...form, amount: Number(form.amount || 0), cashbookAccount: form.cashbookAccount || null });
      closeModal();
      await load();
      toast.success("Expense recorded");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to record expense");
    }
  };

  const updateStatus = async (row, status) => {
    let notes = row.notes || "";
    if (status === row.status) return;
    if (status === "cancelled") {
      const input = window.prompt("Reason for cancelling this expense?", row.notes || "");
      if (input === null) return;
      notes = input;
    }
    const cashbookAccount =
      row.cashbookAccount?._id ||
      row.cashbookAccount ||
      (status === "paid" ? preferredCashbookForMethod(cashbooks, row.method || "cash") : null);
    if (status === "paid" && !cashbookAccount) {
      toast.error("Select a cashbook before marking this expense as paid");
      return;
    }
    try {
      await carWashApi.updateExpenseStatus(row._id, { status, notes, cashbookAccount });
      await load();
      toast.success("Expense status updated");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update expense");
    }
  };

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  return (
    <CarWashShell
      title="Expenses Register"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={openModal} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]">
            <FaPlus />
            New Expense
          </button>
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-[150px_150px_180px_150px_220px_1fr_auto_auto]">
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" value={filters.date} onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))} />
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
          <option value="">All status</option>
          {statuses.map((status) => <option key={status} value={status}>{status.toUpperCase()}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.category} onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}>
          <option value="">All categories</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.method} onChange={(event) => setFilters((prev) => ({ ...prev, method: event.target.value }))}>
          <option value="">All methods</option>
          {methods.map((method) => <option key={method} value={method}>{method.toUpperCase()}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.cashbookAccount} onChange={(event) => setFilters((prev) => ({ ...prev, cashbookAccount: event.target.value }))}>
          <option value="">All cashbooks</option>
          {cashbooks.map((account) => <option key={account._id} value={account._id}>{account.code} - {account.name}</option>)}
        </select>
        <input className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" placeholder="Payee / ref / description" value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch />Search</button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt />Reset</button>
      </form>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page Total: <strong className="text-[#0B3B2E]">{formatMoney(pageTotal)}</strong></span>
          <span>Total: <strong className="text-[#0B3B2E]">{formatMoney(summary?.totalAmount)}</strong></span>
          <span>Paid: <strong className="text-[#0B3B2E]">{formatMoney(summary?.paid?.amount)}</strong></span>
          <span>Draft: <strong className="text-slate-900">{summary?.draft?.count || 0}</strong></span>
          <span>Approved: <strong className="text-cyan-700">{summary?.approved?.count || 0}</strong></span>
          <span>Cancelled: <strong className="text-red-700">{summary?.cancelled?.count || 0}</strong></span>
        </div>
        <table className="w-full min-w-[1120px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left" />
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Expense</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Payee</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th>
              {isConsolidated && <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>}
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Cashbook</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => {
              const expanded = expandedIds.includes(row._id);
              return (
                <React.Fragment key={row._id}>
                  <tr className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-2 py-1"><button type="button" onClick={() => toggleExpanded(row._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]">{expanded ? <FaChevronDown /> : <FaChevronRight />}</button></td>
                    <td className="px-2 py-1 text-slate-700">{row.expenseDate ? new Date(row.expenseDate).toLocaleDateString("en-GB") : "-"}</td>
                    <td className="px-2 py-1 font-extrabold text-slate-900">{row.expenseNumber || "-"}</td>
                    <td className="px-2 py-1 font-semibold text-slate-800">{row.payee || "-"}</td>
                    <td className="px-2 py-1 text-slate-700">{row.category || "-"}</td>
                    {isConsolidated && <td className="px-2 py-1 text-slate-600">{row.branch?.name || <span className="text-slate-400">—</span>}</td>}
                    <td className="px-2 py-1 font-bold uppercase text-slate-700">{row.method || "-"}</td>
                    <td className="px-2 py-1 font-semibold text-slate-800">{row.cashbookAccount ? `${row.cashbookAccount.code || ""} ${row.cashbookAccount.name || ""}`.trim() : "-"}</td>
                    <td className="px-2 py-1">
                      <select className={`h-6 border px-2 text-[11px] font-bold uppercase ${statusBadgeClass[row.status || "draft"] || statusBadgeClass.draft}`} value={row.status || "draft"} onChange={(event) => updateStatus(row, event.target.value)} disabled={["paid", "cancelled"].includes(row.status)}>
                        {statusOptionsFor(row.status || "draft").map((status) => <option key={status} value={status}>{status.toUpperCase()}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                      <td colSpan={isConsolidated ? 10 : 9} className="px-10 py-2 text-[11px] text-slate-600">
                        <div className="grid gap-3 md:grid-cols-5">
                          <div><span className="font-extrabold uppercase text-slate-500">Reference:</span> {row.reference || "-"}</div>
                          <div><span className="font-extrabold uppercase text-slate-500">Created By:</span> {row.createdBy?.name || row.createdBy?.username || row.createdBy?.email || "-"}</div>
                          <div><span className="font-extrabold uppercase text-slate-500">Approved By:</span> {row.approvedBy?.name || row.approvedBy?.username || row.approvedBy?.email || "-"}</div>
                          <div><span className="font-extrabold uppercase text-slate-500">Paid By:</span> {row.paidBy?.name || row.paidBy?.username || row.paidBy?.email || "-"}</div>
                          <div><span className="font-extrabold uppercase text-slate-500">Paid At:</span> {row.paidAt ? new Date(row.paidAt).toLocaleString("en-KE") : "-"}</div>
                          <div className="md:col-span-3"><span className="font-extrabold uppercase text-slate-500">Description:</span> {row.description || "-"}</div>
                          <div className="md:col-span-2"><span className="font-extrabold uppercase text-slate-500">Notes:</span> {row.notes || "-"}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            }) : (
              <tr><td colSpan={isConsolidated ? 10 : 9} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No Car Wash expenses found for the selected filters.</td></tr>
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
          title="Record Expense"
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="submit" form="carwash-expense-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">Save Expense</button>
            </>
          }
        >
          <form id="carwash-expense-form" onSubmit={createExpense} className="grid gap-3 md:grid-cols-2">
            <div><label className={labelClass}>Expense Date *</label><input type="date" className={inputClass} value={form.expenseDate} onChange={(event) => setForm((prev) => ({ ...prev, expenseDate: event.target.value }))} required /></div>
            <div><label className={labelClass}>Amount *</label><input type="number" min="1" className={inputClass} value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} required autoFocus /></div>
            <div><label className={labelClass}>Payee</label><input className={inputClass} value={form.payee} onChange={(event) => setForm((prev) => ({ ...prev, payee: event.target.value }))} placeholder="Supplier, staff, utility provider..." /></div>
            <div><label className={labelClass}>Category</label><select className={inputClass} value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></div>
            <div><label className={labelClass}>Method</label><select className={inputClass} value={form.method} onChange={(event) => setForm((prev) => ({ ...prev, method: event.target.value, cashbookAccount: preferredCashbookForMethod(cashbooks, event.target.value) }))}>{methods.map((method) => <option key={method} value={method}>{method.toUpperCase()}</option>)}</select></div>
            <div><label className={labelClass}>Status</label><select className={inputClass} value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}><option value="paid">Paid</option><option value="draft">Draft</option><option value="approved">Approved</option></select></div>
            <div><label className={labelClass}>Cashbook Paid From {form.status === "paid" ? "*" : ""}</label><select className={inputClass} value={form.cashbookAccount} onChange={(event) => setForm((prev) => ({ ...prev, cashbookAccount: event.target.value }))} required={form.status === "paid"}><option value="">Select cashbook</option>{cashbooks.map((account) => <option key={account._id} value={account._id}>{account.code} - {account.name}</option>)}</select></div>
            <div><label className={labelClass}>Reference</label><input className={inputClass} value={form.reference} onChange={(event) => setForm((prev) => ({ ...prev, reference: event.target.value }))} placeholder="Receipt, M-Pesa code, bank ref..." /></div>
            <div className="md:col-span-2"><label className={labelClass}>Description</label><input className={inputClass} value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="What was this expense for?" /></div>
            <div className="md:col-span-2"><label className={labelClass}>Notes</label><textarea className="min-h-16 w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} /></div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashExpenses;
