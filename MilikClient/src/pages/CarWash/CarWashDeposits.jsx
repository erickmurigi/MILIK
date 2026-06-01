import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaChevronDown, FaChevronRight, FaPlus, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const PAGE_SIZE = 30;
const destinations = ["bank", "mpesa", "safe", "other"];
const statuses = ["pending", "confirmed", "cancelled"];
const defaultFilters = { date: todayISO(), status: "", destination: "", cashbookAccount: "", reference: "" };
const emptyForm = { depositDate: todayISO(), amount: "", destination: "bank", cashbookAccount: "", reference: "", notes: "" };
const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const statusBadgeClass = {
  pending: "border-orange-200 bg-orange-50 text-orange-700",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

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

const CarWashDeposits = () => {
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
  const [summary, setSummary] = useState({ pending: {}, confirmed: {}, cancelled: {}, totalAmount: 0, totalCount: 0 });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listDeposits({ ...appliedFilters, limit: PAGE_SIZE, page });
      const deposits = normalizeListPayload(payload, "deposits");
      setRows(deposits);
      setPagination(payload?.pagination || { page, limit: PAGE_SIZE, total: deposits.length, pages: 1 });
      setSummary(payload?.summary || { pending: {}, confirmed: {}, cancelled: {}, totalAmount: 0, totalCount: 0 });
      setExpandedIds([]);
    } catch {
      toast.error("Failed to load Car Wash deposits");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [appliedFilters, page]);

  const loadCashbooks = async () => {
    if (!currentCompany?._id) return;
    try {
      const accounts = await carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" });
      const options = (Array.isArray(accounts) ? accounts : []).filter((account) =>
        String(account?.subGroup || "").toLowerCase().includes("cashbook") && account.isPosting !== false
      );
      setCashbooks(options);
      setForm((prev) => (prev.cashbookAccount || !options[0]?._id ? prev : { ...prev, cashbookAccount: options[0]._id }));
    } catch {
      toast.error("Failed to load deposit cashbooks");
    }
  };

  useEffect(() => {
    loadCashbooks();
  }, [currentCompany?._id]);

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
    setForm({ ...emptyForm, cashbookAccount: cashbooks[0]?._id || "" });
  };

  const openModal = () => {
    setForm((prev) => ({ ...prev, cashbookAccount: prev.cashbookAccount || cashbooks[0]?._id || "" }));
    setShowModal(true);
  };

  const createDeposit = async (event) => {
    event.preventDefault();
    try {
      if (!form.cashbookAccount) {
        toast.error("Select the cashbook where this deposit was made");
        return;
      }
      await carWashApi.createDeposit({ ...form, amount: Number(form.amount || 0) });
      closeModal();
      await load();
      toast.success("Deposit recorded");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to record deposit");
    }
  };

  const updateStatus = async (row, status) => {
    const notes = status === "cancelled" ? window.prompt("Reason for cancelling this deposit?", row.notes || "") || "" : row.notes || "";
    try {
      await carWashApi.updateDepositStatus(row._id, { status, notes });
      await load();
      toast.success("Deposit status updated");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update deposit");
    }
  };

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  return (
    <CarWashShell
      title="Deposits Register"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={openModal} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]">
            <FaPlus />
            New Deposit
          </button>
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-[160px_160px_190px_220px_1fr_auto_auto]">
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" value={filters.date} onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))} />
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
          <option value="">All status</option>
          {statuses.map((status) => <option key={status} value={status}>{status.toUpperCase()}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.destination} onChange={(event) => setFilters((prev) => ({ ...prev, destination: event.target.value }))}>
          <option value="">All destinations</option>
          {destinations.map((destination) => <option key={destination} value={destination}>{destination.toUpperCase()}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.cashbookAccount} onChange={(event) => setFilters((prev) => ({ ...prev, cashbookAccount: event.target.value }))}>
          <option value="">All cashbooks</option>
          {cashbooks.map((account) => <option key={account._id} value={account._id}>{account.code} - {account.name}</option>)}
        </select>
        <input className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" placeholder="Reference" value={filters.reference} onChange={(event) => setFilters((prev) => ({ ...prev, reference: event.target.value }))} />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch />Search</button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt />Reset</button>
      </form>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page Total: <strong className="text-[#0B3B2E]">{formatMoney(pageTotal)}</strong></span>
          <span>Pending: <strong className="text-[#FF8C00]">{formatMoney(summary?.pending?.amount)}</strong></span>
          <span>Confirmed: <strong className="text-[#0B3B2E]">{formatMoney(summary?.confirmed?.amount)}</strong></span>
          <span>Cancelled: <strong className="text-red-700">{formatMoney(summary?.cancelled?.amount)}</strong></span>
        </div>
        <table className="w-full min-w-[1060px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left" />
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Deposit</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Destination</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Cashbook</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Reference</th>
              {isConsolidated && <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>}
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
                    <td className="px-2 py-1 text-slate-700">{row.depositDate ? new Date(row.depositDate).toLocaleDateString("en-GB") : "-"}</td>
                    <td className="px-2 py-1 font-extrabold text-slate-900">{row.depositNumber || "-"}</td>
                    <td className="px-2 py-1 font-bold uppercase text-slate-700">{row.destination || "-"}</td>
                    <td className="px-2 py-1 font-semibold text-slate-800">{row.cashbookAccount ? `${row.cashbookAccount.code || ""} ${row.cashbookAccount.name || ""}`.trim() : "-"}</td>
                    <td className="px-2 py-1 text-slate-700">{row.reference || "-"}</td>
                    {isConsolidated && <td className="px-2 py-1 text-slate-600">{row.branch?.name || <span className="text-slate-400">—</span>}</td>}
                    <td className="px-2 py-1">
                      <select className={`h-6 border px-2 text-[11px] font-bold uppercase ${statusBadgeClass[row.status || "pending"] || statusBadgeClass.pending}`} value={row.status || "pending"} onChange={(event) => updateStatus(row, event.target.value)}>
                        {statuses.map((status) => <option key={status} value={status}>{status.toUpperCase()}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                      <td colSpan={isConsolidated ? 9 : 8} className="px-10 py-2 text-[11px] text-slate-600">
                        <div className="grid gap-3 md:grid-cols-5">
                          <div><span className="font-extrabold uppercase text-slate-500">Deposited By:</span> {row.depositedBy?.name || row.depositedBy?.username || row.depositedBy?.email || "-"}</div>
                          <div><span className="font-extrabold uppercase text-slate-500">Confirmed By:</span> {row.confirmedBy?.name || row.confirmedBy?.username || row.confirmedBy?.email || "-"}</div>
                          <div><span className="font-extrabold uppercase text-slate-500">Confirmed At:</span> {row.confirmedAt ? new Date(row.confirmedAt).toLocaleString("en-KE") : "-"}</div>
                          <div><span className="font-extrabold uppercase text-slate-500">Created:</span> {row.createdAt ? new Date(row.createdAt).toLocaleString("en-KE") : "-"}</div>
                          <div className="md:col-span-5"><span className="font-extrabold uppercase text-slate-500">Notes:</span> {row.notes || "-"}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            }) : (
              <tr><td colSpan={isConsolidated ? 9 : 8} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No Car Wash deposits found for the selected filters.</td></tr>
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
          title="Record Cash Deposit"
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="submit" form="carwash-deposit-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">Save Deposit</button>
            </>
          }
        >
          <form id="carwash-deposit-form" onSubmit={createDeposit} className="grid gap-3 md:grid-cols-2">
            <div><label className={labelClass}>Deposit Date *</label><input type="date" className={inputClass} value={form.depositDate} onChange={(event) => setForm((prev) => ({ ...prev, depositDate: event.target.value }))} required /></div>
            <div><label className={labelClass}>Amount *</label><input type="number" min="1" className={inputClass} value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} required autoFocus /></div>
            <div><label className={labelClass}>Destination</label><select className={inputClass} value={form.destination} onChange={(event) => setForm((prev) => ({ ...prev, destination: event.target.value }))}>{destinations.map((destination) => <option key={destination} value={destination}>{destination.toUpperCase()}</option>)}</select></div>
            <div><label className={labelClass}>Cashbook Account *</label><select className={inputClass} value={form.cashbookAccount} onChange={(event) => setForm((prev) => ({ ...prev, cashbookAccount: event.target.value }))} required><option value="">Select cashbook</option>{cashbooks.map((account) => <option key={account._id} value={account._id}>{account.code} - {account.name}</option>)}</select></div>
            <div className="md:col-span-2"><label className={labelClass}>Reference</label><input className={inputClass} value={form.reference} onChange={(event) => setForm((prev) => ({ ...prev, reference: event.target.value }))} placeholder="Bank slip, M-Pesa ref..." /></div>
            <div className="md:col-span-2"><label className={labelClass}>Notes</label><textarea className="min-h-20 w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} /></div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashDeposits;
