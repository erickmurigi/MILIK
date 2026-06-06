import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaChevronDown, FaChevronRight, FaRedoAlt, FaSearch, FaSms, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";

const defaultFilters = { date: todayISO(), method: "", cashbookAccount: "", reference: "", reconciliationStatus: "" };
const DEFAULT_PAGE_SIZE = 25;
const reconciliationStatuses = ["pending", "reconciled", "flagged"];
const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];

const reconciliationBadgeClass = {
  pending: "border-orange-200 bg-orange-50 text-orange-700",
  reconciled: "border-emerald-200 bg-emerald-50 text-emerald-700",
  flagged: "border-red-200 bg-red-50 text-red-700",
};

const CarWashPayments = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const isConsolidated = !getActiveBranchId();
  const [rows, setRows] = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [expandedIds, setExpandedIds] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pagination, setPagination] = useState({ page: 1, limit: DEFAULT_PAGE_SIZE, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [smsTarget, setSmsTarget] = useState(null);
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listPayments({ ...appliedFilters, limit: pageSize, page });
      const payments = normalizeListPayload(payload, "payments");
      setRows(payments);
      setPagination(payload?.pagination || { page, limit: pageSize, total: payments.length, pages: 1 });
      setExpandedIds([]);
    } catch {
      toast.error("Failed to load payments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [appliedFilters, page, pageSize]);

  const loadCashbooks = async () => {
    if (!currentCompany?._id) return;
    try {
      const accounts = await carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" });
      setCashbooks(Array.isArray(accounts) ? accounts : []);
    } catch {
      setCashbooks([]);
    }
  };

  useEffect(() => {
    loadCashbooks();
  }, [currentCompany?._id]);

  const rowStats = useMemo(() => {
    let totalAmount = 0, pendingCount = 0, reconciledCount = 0, flaggedCount = 0;
    rows.forEach((row) => {
      totalAmount += Number(row.amount || 0);
      const status = row.reconciliationStatus || "pending";
      if (status === "pending") pendingCount++;
      else if (status === "reconciled") reconciledCount++;
      else if (status === "flagged") flaggedCount++;
    });
    return { totalAmount, pendingCount, reconciledCount, flaggedCount };
  }, [rows]);
  const { totalAmount, pendingCount, reconciledCount, flaggedCount } = rowStats;

  const buildPaymentTemplates = (row) => {
    const name   = row.job?.customerName || "Customer";
    const amount = Number(row.amount || 0).toLocaleString();
    const num    = row.job?.jobNumber || "";
    const plate  = row.job?.plateNumber || "";
    return [
      { label: "Payment Confirmed", color: "green",  body: `Hi ${name}! Payment of KES ${amount} received for ${plate || num} wash. Thank you!` },
      { label: "Receipt",           color: "blue",   body: `Hi ${name}, your payment of KES ${amount} for car wash job ${num} has been received. Your balance is now cleared. Thank you for choosing us!` },
      { label: "Partial Payment",   color: "amber",  body: `Hi ${name}, we've received KES ${amount} toward your car wash job ${num}. Please pay the remaining balance at your convenience. Thank you!` },
    ];
  };

  const openSmsModal = (row) => {
    setSmsTarget(row);
    const name   = row.job?.customerName || "Customer";
    const amount = Number(row.amount || 0).toLocaleString();
    const plate  = row.job?.plateNumber || "";
    const num    = row.job?.jobNumber || "";
    setSmsBody(`Hi ${name}! Payment of KES ${amount} received for ${plate || num} wash. Thank you!`);
  };

  // Resolve the best SMS target phone for a payment:
  // 1. M-Pesa sender phone (stored at payment time — most accurate for Paybill)
  // 2. Customer phone from the job record
  const resolvePaymentSmsPhone = (row) =>
    row.receivedFromPhone || row.job?.phone || "";

  const sendSms = async (phone, body) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      await carWashApi.sendPaymentSms(smsTarget._id, { phone, body });
      toast.success("SMS sent successfully");
      setSmsTarget(null);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

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

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const updateReconciliation = async (row, status) => {
    const note = status === "flagged" ? window.prompt("Reason for flagging this payment?", row.reconciliationNote || "") || "" : row.reconciliationNote || "";
    try {
      await carWashApi.updatePaymentReconciliation(row._id, { reconciliationStatus: status, reconciliationNote: note });
      await load();
      toast.success("Payment reconciliation updated");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update reconciliation");
    }
  };

  return (
    <CarWashShell
      title="Payments Register"
      action={
        <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaRedoAlt className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 flex-shrink-0 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-[170px_170px_220px_180px_1fr_auto_auto]">
        <input
          type="date"
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.date}
          onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))}
        />
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.method}
          onChange={(event) => setFilters((prev) => ({ ...prev, method: event.target.value }))}
        >
          <option value="">All methods</option>
          {paymentMethods.map((method) => (
            <option key={method} value={method}>{method.toUpperCase()}</option>
          ))}
        </select>
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.cashbookAccount}
          onChange={(event) => setFilters((prev) => ({ ...prev, cashbookAccount: event.target.value }))}
        >
          <option value="">All cashbooks</option>
          {cashbooks.map((account) => (
            <option key={account._id} value={account._id}>{account.code} - {account.name}</option>
          ))}
        </select>
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.reconciliationStatus}
          onChange={(event) => setFilters((prev) => ({ ...prev, reconciliationStatus: event.target.value }))}
        >
          <option value="">All reconciliation</option>
          {reconciliationStatuses.map((status) => (
            <option key={status} value={status}>{status.toUpperCase()}</option>
          ))}
        </select>
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Reference / receipt code"
          value={filters.reference}
          onChange={(event) => setFilters((prev) => ({ ...prev, reference: event.target.value }))}
        />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch />
          Search
        </button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt />
          Reset
        </button>
      </form>

      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <div className="flex-shrink-0 flex flex-wrap min-h-8 items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Page Total: <strong className="text-[#0B3B2E]">{formatMoney(totalAmount)}</strong></span>
          <span>Date: <strong className="text-slate-900">{appliedFilters.date || "All"}</strong></span>
          <span>Pending: <strong className="text-[#FF8C00]">{pendingCount}</strong></span>
          <span>Reconciled: <strong className="text-[#0B3B2E]">{reconciledCount}</strong></span>
          <span>Flagged: <strong className="text-red-700">{flaggedCount}</strong></span>
        </div>
        {/* Mobile card list */}
        <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-200">
          {rows.length ? rows.map((row) => {
            const expanded = expandedIds.includes(row._id);
            const phone = resolvePaymentSmsPhone(row);
            return (
              <React.Fragment key={row._id}>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-extrabold text-slate-900">{row.job?.jobNumber || "-"}</span>
                        <span className="font-bold uppercase text-slate-700">{row.method || "-"}</span>
                        <span className={`inline-flex border px-1.5 py-0.5 text-[10px] font-bold uppercase ${reconciliationBadgeClass[row.reconciliationStatus || "pending"] || reconciliationBadgeClass.pending}`}>{row.reconciliationStatus || "pending"}</span>
                      </div>
                      <div className="mt-0.5 font-bold uppercase text-slate-800">{row.job?.plateNumber || "-"}</div>
                      {row.job?.customerName && <div className="text-xs text-slate-500">{row.job.customerName}</div>}
                      {row.paymentDate && <div className="text-[10px] text-slate-400">{new Date(row.paymentDate).toLocaleDateString("en-GB")}</div>}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="font-extrabold text-slate-900">{formatMoney(row.amount)}</div>
                      <select
                        className={`mt-1 h-6 border px-1.5 text-[10px] font-bold uppercase ${reconciliationBadgeClass[row.reconciliationStatus || "pending"] || reconciliationBadgeClass.pending}`}
                        value={row.reconciliationStatus || "pending"}
                        onChange={(e) => updateReconciliation(row, e.target.value)}
                      >
                        {reconciliationStatuses.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {phone && (
                      <button type="button" onClick={() => openSmsModal(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-xs font-bold text-[#0B3B2E]">
                        <FaSms /> SMS
                      </button>
                    )}
                    <button type="button" onClick={() => toggleExpanded(row._id)} className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
                      {expanded ? <FaChevronDown className="text-[9px]" /> : <FaChevronRight className="text-[9px]" />} Details
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-2 space-y-1 rounded border border-slate-200 bg-[#F8FBF9] p-2 text-[11px] text-slate-600">
                      <div><span className="font-extrabold uppercase text-slate-500">Reference:</span> {row.reference || "-"}</div>
                      <div><span className="font-extrabold uppercase text-slate-500">Cashbook:</span> {row.cashbookAccount ? `${row.cashbookAccount.code} - ${row.cashbookAccount.name}` : "-"}</div>
                      <div><span className="font-extrabold uppercase text-slate-500">Customer:</span> {row.job?.customerName || "-"}</div>
                      {row.receivedFromPhone && <div><span className="font-extrabold uppercase text-slate-500">M-Pesa Phone:</span> {row.receivedFromPhone}</div>}
                      {row.reconciliationNote && <div><span className="font-extrabold uppercase text-slate-500">Note:</span> {row.reconciliationNote}</div>}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          }) : (
            <div className="py-10 text-center text-xs font-semibold text-slate-500">No Car Wash payments found for the selected filters.</div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:flex sm:flex-col sm:flex-1 sm:min-h-0 sm:overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-auto">
        <table className="w-full min-w-[1120px] text-xs">
          <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left" />
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Job</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Plate</th>
              {isConsolidated && <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>}
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Cashbook</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Reference</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Reconciliation</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const expanded = expandedIds.includes(row._id);
                return (
                  <React.Fragment key={row._id}>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-1">
                        <button type="button" onClick={() => toggleExpanded(row._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]">
                          {expanded ? <FaChevronDown /> : <FaChevronRight />}
                        </button>
                      </td>
                      <td className="px-2 py-1 text-slate-700">{row.paymentDate ? new Date(row.paymentDate).toLocaleDateString("en-GB") : "-"}</td>
                      <td className="px-2 py-1 font-extrabold text-slate-900">{row.job?.jobNumber || "-"}</td>
                      <td className="px-2 py-1 font-bold uppercase text-slate-800">{row.job?.plateNumber || "-"}</td>
                      {isConsolidated && <td className="px-2 py-1 text-slate-600">{row.branch?.name || <span className="text-slate-400">—</span>}</td>}
                      <td className="px-2 py-1 font-bold text-slate-700">{row.method?.toUpperCase() || "-"}</td>
                      <td className="px-2 py-1 font-semibold text-slate-700">{row.cashbookAccount ? `${row.cashbookAccount.code} - ${row.cashbookAccount.name}` : "-"}</td>
                      <td className="px-2 py-1 text-slate-700">{row.reference || "-"}</td>
                      <td className="px-2 py-1">
                        <select
                          className={`h-6 border px-2 text-[11px] font-bold uppercase ${reconciliationBadgeClass[row.reconciliationStatus || "pending"] || reconciliationBadgeClass.pending}`}
                          value={row.reconciliationStatus || "pending"}
                          onChange={(event) => updateReconciliation(row, event.target.value)}
                        >
                          {reconciliationStatuses.map((status) => (
                            <option key={status} value={status}>{status.toUpperCase()}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                        <td colSpan={isConsolidated ? 10 : 9} className="px-10 py-2 text-[11px] text-slate-600">
                          <div className="grid gap-3 md:grid-cols-5">
                            <div><span className="font-extrabold uppercase text-slate-500">Time:</span> {row.paymentDate ? new Date(row.paymentDate).toLocaleString("en-KE") : "-"}</div>
                            <div className="flex items-center gap-2">
                              <div><span className="font-extrabold uppercase text-slate-500">Customer:</span> {row.job?.customerName || "-"}</div>
                              {(row.receivedFromPhone || row.job?.phone) && (
                                <button
                                  type="button"
                                  onClick={() => openSmsModal(row)}
                                  className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                                  title={`Send SMS to ${row.receivedFromPhone || row.job?.phone}`}
                                >
                                  <FaSms /> SMS
                                  {row.receivedFromPhone && (
                                    <span className="rounded bg-emerald-100 px-1 text-[9px] font-black text-emerald-700">M-Pesa</span>
                                  )}
                                </button>
                              )}
                            </div>
                            <div><span className="font-extrabold uppercase text-slate-500">Service:</span> {row.job?.serviceName || "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Job Status:</span> {row.job?.status || "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Received By:</span> {row.receivedBy?.name || row.receivedBy?.username || row.receivedBy?.email || "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Cashbook:</span> {row.cashbookAccount ? `${row.cashbookAccount.code} - ${row.cashbookAccount.name}` : "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Reviewed By:</span> {row.reconciledBy?.name || row.reconciledBy?.username || row.reconciledBy?.email || "-"}</div>
                            <div><span className="font-extrabold uppercase text-slate-500">Reviewed At:</span> {row.reconciledAt ? new Date(row.reconciledAt).toLocaleString("en-KE") : "-"}</div>
                            <div className="md:col-span-3"><span className="font-extrabold uppercase text-slate-500">Reconciliation Note:</span> {row.reconciliationNote || "-"}</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={isConsolidated ? 10 : 9} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No Car Wash payments found for the selected filters.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>{/* end scroll */}
        </div>{/* end desktop table wrapper */}
        <div className="flex-shrink-0 flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500 normal-case">Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition normal-case"
            >
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1 || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Previous</button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button type="button" onClick={() => setPage((prev) => Math.min(prev + 1, pagination.pages))} disabled={page >= pagination.pages || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Next</button>
          </div>
        </div>
      </div>
      {smsTarget && (
        <CwSmsModal
          target={{ _id: smsTarget._id, name: smsTarget.job?.customerName, phone: resolvePaymentSmsPhone(smsTarget) }}
          defaultBody={smsBody}
          templates={buildPaymentTemplates(smsTarget)}
          context={`Payment · ${smsTarget.job?.jobNumber || ""}${smsTarget.receivedFromPhone ? ` · M-Pesa: ${smsTarget.receivedFromPhone}` : ""}`}
          onSend={sendSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}
    </CarWashShell>
  );
};

export default CarWashPayments;
