import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clearDraft, readDraft, writeDraft } from "../../hooks/useFormDraft";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { useTabState } from "../../hooks/useTabState";
import { FaChevronDown, FaChevronRight, FaPlus, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import PaginationBar from "../../components/PaginationBar";
import AppSelect from "../../components/common/AppSelect";

const DEFAULT_PAGE_SIZE = 25;
const destinations = ["bank", "mpesa", "safe", "other"];
const statuses = ["pending", "confirmed", "cancelled"];
// Only the allowed forward transitions from each status
const nextStatuses = {
  pending:   ["pending", "confirmed", "cancelled"],
  confirmed: ["confirmed", "cancelled"],
  cancelled: ["cancelled"],
};
const defaultFilters = { date: todayISO(), status: "", destination: "", cashbookAccount: "", reference: "" };
const emptyForm = { depositDate: todayISO(), amount: "", destination: "bank", cashbookAccount: "", reference: "", notes: "", branch: "" };
const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const statusBadgeClass = {
  pending: "border-orange-200 bg-orange-50 text-orange-700",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-2xl sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
      <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white" title="Close">
          <FaTimes />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const CarWashDeposits = () => {
  const queryClient = useQueryClient();
  const currentCompany = useSelector(selectCurrentCompany);
  const isConsolidated = !getActiveBranchId();
  const [filters, setFilters] = useTabState("/carwash/deposits:filters", defaultFilters);
  const [appliedFilters, setAppliedFilters] = useTabState("/carwash/deposits:appliedFilters", defaultFilters);
  const [form, setForm] = useState(() => readDraft("cw-deposits-form") || emptyForm);
  const [expandedIds, setExpandedIds] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useTabState("/carwash/deposits:page", 1);
  const [pageSize, setPageSize] = useTabState("/carwash/deposits:pageSize", DEFAULT_PAGE_SIZE);
  const canCreate = useCarWashPermission("carwash-deposits", "create");
  const canUpdate = useCarWashPermission("carwash-deposits", "update");

  const depositsQueryKey = ["cw-deposits", appliedFilters, page, pageSize];

  const { data: depositsData, isLoading: loading, error, refetch } = useQuery({
    queryKey: depositsQueryKey,
    queryFn: () => carWashApi.listDeposits({ ...appliedFilters, limit: pageSize, page }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: cashbooksRaw } = useQuery({
    queryKey: ["cw-deposit-cashbooks", currentCompany?._id],
    queryFn: async () => {
      const accounts = await carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" });
      return (Array.isArray(accounts) ? accounts : []).filter((account) =>
        String(account?.subGroup || "").toLowerCase().includes("cashbook") && account.isPosting !== false
      );
    },
    enabled: !!currentCompany?._id,
    staleTime: 5 * 60_000,
  });

  const { data: branchesRaw } = useQuery({
    queryKey: ["cw-branches-all"],
    queryFn: () => carWashApi.listBranches({ limit: 100 }),
    enabled: isConsolidated,
    staleTime: 5 * 60_000,
  });
  const branches = normalizeListPayload(branchesRaw, "branches");

  useEffect(() => { if (error) toast.error("Failed to load Car Wash deposits"); }, [error]);
  useEffect(() => { setExpandedIds([]); }, [depositsData]);

  const cashbooks = cashbooksRaw ?? [];
  const rows = normalizeListPayload(depositsData, "deposits");
  const pagination = depositsData?.pagination || { page, limit: pageSize, total: rows.length, pages: 1 };
  const summary = depositsData?.summary || { pending: {}, confirmed: {}, cancelled: {}, totalAmount: 0, totalCount: 0 };

  // Auto-select first cashbook when form opens without a selection
  useEffect(() => {
    if (cashbooks[0]?._id) {
      setForm((prev) => prev.cashbookAccount ? prev : { ...prev, cashbookAccount: cashbooks[0]._id });
    }
  }, [cashbooks]);

  // Auto-save deposit form draft
  useEffect(() => {
    const dirty = form.amount || form.reference || form.notes;
    if (!dirty) { clearDraft("cw-deposits-form"); return; }
    const t = setTimeout(() => writeDraft("cw-deposits-form", form), 400);
    return () => clearTimeout(t);
  }, [form]);

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
    clearDraft("cw-deposits-form");
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
      if (isConsolidated && !form.branch) {
        toast.error("Select a branch for this deposit");
        return;
      }
      if (!form.cashbookAccount) {
        toast.error("Select the cashbook where this deposit was made");
        return;
      }
      await carWashApi.createDeposit({ ...form, amount: Number(form.amount || 0) });
      closeModal();
      await queryClient.invalidateQueries({ queryKey: ["cw-deposits"] });
      toast.success("Deposit recorded");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to record deposit");
    }
  };

  const updateStatus = async (row, status) => {
    const notes = status === "cancelled" ? window.prompt("Reason for cancelling this deposit?", row.notes || "") || "" : row.notes || "";
    try {
      await carWashApi.updateDepositStatus(row._id, { status, notes });
      await queryClient.invalidateQueries({ queryKey: ["cw-deposits"] });
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
          <button type="button" onClick={() => refetch()} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          {canCreate && (
            <button type="button" onClick={openModal} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]">
              <FaPlus />
              New Deposit
            </button>
          )}
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 flex-shrink-0 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-[160px_160px_190px_220px_1fr_auto_auto]">
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" value={filters.date} onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))} />
        <AppSelect
          size="sm"
          clearable
          placeholder="All status"
          value={filters.status}
          onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "" }))}
          options={statuses.map((status) => ({ value: status, label: status.toUpperCase() }))}
        />
        <AppSelect
          size="sm"
          clearable
          placeholder="All destinations"
          value={filters.destination}
          onChange={(v) => setFilters((prev) => ({ ...prev, destination: v ?? "" }))}
          options={destinations.map((destination) => ({ value: destination, label: destination.toUpperCase() }))}
        />
        <AppSelect
          size="sm"
          clearable
          searchable
          placeholder="All cashbooks"
          value={filters.cashbookAccount}
          onChange={(v) => setFilters((prev) => ({ ...prev, cashbookAccount: v ?? "" }))}
          options={cashbooks.map((account) => ({ value: account._id, label: `${account.code} - ${account.name}` }))}
        />
        <input className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" placeholder="Reference" value={filters.reference} onChange={(event) => setFilters((prev) => ({ ...prev, reference: event.target.value }))} />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch />Search</button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt />Reset</button>
      </form>

      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <div className="flex-shrink-0 flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page Total: <strong className="text-[#0B3B2E]">{formatMoney(pageTotal)}</strong></span>
          <span>Pending: <strong className="text-[#FF8C00]">{formatMoney(summary?.pending?.amount)}</strong></span>
          <span>Confirmed: <strong className="text-[#0B3B2E]">{formatMoney(summary?.confirmed?.amount)}</strong></span>
          <span>Cancelled: <strong className="text-red-700">{formatMoney(summary?.cancelled?.amount)}</strong></span>
        </div>

        {/* Mobile card list */}
        <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-200">
          {rows.length ? rows.map((row) => {
            const expanded = expandedIds.includes(row._id);
            return (
              <React.Fragment key={row._id}>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-extrabold text-slate-900">{row.depositNumber || "-"}</span>
                        <span className={`inline-flex border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass[row.status || "pending"] || statusBadgeClass.pending}`}>{row.status || "pending"}</span>
                      </div>
                      <div className="mt-0.5 font-bold uppercase text-slate-700">{row.destination || "-"}</div>
                      {row.depositDate && <div className="text-[10px] text-slate-400">{new Date(row.depositDate).toLocaleDateString("en-GB")}</div>}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="font-extrabold text-slate-900">{formatMoney(row.amount)}</div>
                      {canUpdate ? (
                        <AppSelect
                          size="sm"
                          value={row.status || "pending"}
                          onChange={(v) => updateStatus(row, v ?? "pending")}
                          className={`mt-1 ${statusBadgeClass[row.status || "pending"] || statusBadgeClass.pending}`}
                          options={(nextStatuses[row.status || "pending"] || ["pending"]).map((s) => ({ value: s, label: s.toUpperCase() }))}
                        />
                      ) : (
                        <span className={`mt-1 inline-flex border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass[row.status || "pending"] || statusBadgeClass.pending}`}>{(row.status || "pending").toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                  {row.reference && <div className="mt-1 text-xs text-slate-500">Ref: {row.reference}</div>}
                  <button type="button" onClick={() => toggleExpanded(row._id)} className="mt-2 inline-flex items-center gap-1 border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
                    {expanded ? <FaChevronDown className="text-[9px]" /> : <FaChevronRight className="text-[9px]" />} Details
                  </button>
                  {expanded && (
                    <div className="mt-2 space-y-1 rounded border border-slate-200 bg-[#F8FBF9] p-2 text-[11px] text-slate-600">
                      <div><span className="font-extrabold uppercase text-slate-500">Cashbook:</span> {row.cashbookAccount ? `${row.cashbookAccount.code || ""} ${row.cashbookAccount.name || ""}`.trim() : "-"}</div>
                      <div><span className="font-extrabold uppercase text-slate-500">Deposited By:</span> {row.depositedBy?.name || row.depositedBy?.email || "-"}</div>
                      {row.notes && <div><span className="font-extrabold uppercase text-slate-500">Notes:</span> {row.notes}</div>}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          }) : (
            <div className="py-10 text-center text-xs font-semibold text-slate-500">No Car Wash deposits found for the selected filters.</div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:flex sm:flex-col sm:flex-1 sm:min-h-0 sm:overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-auto">
        <table className="w-full min-w-[1060px] text-xs">
          <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
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
                      {canUpdate ? (
                        <AppSelect
                          size="sm"
                          value={row.status || "pending"}
                          onChange={(v) => updateStatus(row, v ?? "pending")}
                          className={statusBadgeClass[row.status || "pending"] || statusBadgeClass.pending}
                          options={statuses.map((status) => ({ value: status, label: status.toUpperCase() }))}
                        />
                      ) : (
                        <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${statusBadgeClass[row.status || "pending"] || statusBadgeClass.pending}`}>{(row.status || "pending").toUpperCase()}</span>
                      )}
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
        </div>{/* end scroll */}
        </div>{/* end desktop table wrapper */}
        <PaginationBar
          page={pagination.page}
          pages={pagination.pages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          loading={loading}
        />
      </div>

      {showModal && (
        <Modal
          title="Record Cash Deposit"
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              {canCreate && <button type="submit" form="carwash-deposit-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">Save Deposit</button>}
            </>
          }
        >
          <form id="carwash-deposit-form" onSubmit={createDeposit} className="grid gap-3 md:grid-cols-2">
            {isConsolidated && (
              <div className="md:col-span-2">
                <AppSelect
                  size="md"
                  label="Branch"
                  required
                  searchable
                  placeholder="— Select branch —"
                  value={form.branch}
                  onChange={(v) => setForm((prev) => ({ ...prev, branch: v ?? "" }))}
                  options={branches.map((b) => ({ value: b._id, label: b.name }))}
                />
              </div>
            )}
            <div><label className={labelClass}>Deposit Date *</label><input type="date" className={inputClass} value={form.depositDate} onChange={(event) => setForm((prev) => ({ ...prev, depositDate: event.target.value }))} required /></div>
            <div><label className={labelClass}>Amount *</label><input type="number" min="1" className={inputClass} value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} required autoFocus /></div>
            <div>
              <AppSelect
                size="md"
                label="Destination"
                value={form.destination}
                onChange={(v) => setForm((prev) => ({ ...prev, destination: v ?? "bank" }))}
                options={destinations.map((destination) => ({ value: destination, label: destination.toUpperCase() }))}
              />
            </div>
            <div>
              <AppSelect
                size="md"
                label="Cashbook Account"
                required
                searchable
                placeholder="Select cashbook"
                value={form.cashbookAccount}
                onChange={(v) => setForm((prev) => ({ ...prev, cashbookAccount: v ?? "" }))}
                options={cashbooks.map((account) => ({ value: account._id, label: `${account.code} - ${account.name}` }))}
              />
            </div>
            <div className="md:col-span-2"><label className={labelClass}>Reference</label><input className={inputClass} value={form.reference} onChange={(event) => setForm((prev) => ({ ...prev, reference: event.target.value }))} placeholder="Bank slip, M-Pesa ref..." /></div>
            <div className="md:col-span-2"><label className={labelClass}>Notes</label><textarea className="min-h-20 w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} /></div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashDeposits;
