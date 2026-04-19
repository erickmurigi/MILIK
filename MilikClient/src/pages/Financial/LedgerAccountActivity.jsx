import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaArrowLeft,
  FaExchangeAlt,
  FaFilter,
  FaRedoAlt,
  FaSyncAlt,
  FaTrashAlt,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { deleteTenantInvoice, getChartOfAccounts } from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ITEMS_PER_PAGE = 50;

const formatMoney = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const inputDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const accountCanManage = (user) => {
  if (!user) return false;
  if (user.superAdminAccess || user.adminAccess || user.isSystemAdmin) return true;
  const profile = String(user.profile || "").toLowerCase();
  if (["administrator", "accountant"].includes(profile)) return true;
  return String(user.moduleAccess?.accounts || "").toLowerCase() === "full access";
};

const sourceLabel = (entry) => {
  if (entry?.isReversalEntry) return "Reversal Entry";
  if (entry?.isReversedOriginal) return "Reversed Original";
  const type = String(entry?.sourceTransactionType || "other").replace(/_/g, " ");
  return type.replace(/\b\w/g, (m) => m.toUpperCase());
};

const getAuditBadge = (entry) => {
  if (entry?.isReversalEntry) {
    return {
      label: "reversal entry",
      className: "bg-blue-100 text-blue-700",
    };
  }

  if (entry?.isReversedOriginal) {
    return {
      label: "reversed original",
      className: "bg-amber-100 text-amber-700",
    };
  }

  return {
    label: String(entry?.status || "approved").toLowerCase(),
    className: "bg-emerald-100 text-emerald-700",
  };
};

const getAuditCaption = (entry) => {
  if (entry?.isReversalEntry) {
    return `Reversal of ${entry?.reversalOf || "linked entry"}`;
  }

  if (entry?.isReversedOriginal) {
    return `Reversed by ${entry?.reversedByEntry || "linked reversal"}`;
  }

  return "Live activity";
};

const LedgerAccountActivity = () => {
  const navigate = useNavigate();
  const { accountId } = useParams();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);

  const [account, setAccount] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [rows, setRows] = useState([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const today = new Date();
  const [filters, setFilters] = useState({
    startDate: inputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: inputDate(today),
    direction: "all",
    includeReversed: false,
  });

  const [reclassifyModal, setReclassifyModal] = useState({
    open: false,
    entry: null,
    newAccountId: "",
    reason: "",
  });

  const businessId = currentCompany?._id || "";
  const canManage =
    accountCanManage(currentUser) &&
    hasCompanyPermission(currentUser || {}, currentCompany, "ledger", "reverse", "accounts");

  const loadActivity = async () => {
    if (!businessId || !accountId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ business: businessId });
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);
      if (filters.direction && filters.direction !== "all") params.append("direction", filters.direction);
      if (filters.includeReversed) params.append("includeReversed", "true");

      const res = await adminRequests.get(`/chart-of-accounts/${accountId}/activity?${params.toString()}`);
      const payload = res.data?.data || {};
      setAccount(payload.account || null);
      setRows(Array.isArray(payload.entries) ? payload.entries : []);
      setOpeningBalance(Number(payload.openingBalance || 0));
      setClosingBalance(Number(payload.closingBalance || 0));
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to load ledger account activity"
      );
      setRows([]);
      setAccount(null);
      setOpeningBalance(0);
      setClosingBalance(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, accountId]);

  useEffect(() => {
    if (!businessId) return;
    getChartOfAccounts({ business: businessId })
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => setAccounts([]));
  }, [businessId]);

  const reclassifyOptions = useMemo(() => {
    return accounts.filter((item) => item?._id !== accountId && item?.isPosting !== false && !item?.isHeader);
  }, [accounts, accountId]);

  const handleReverseOrDelete = async (entry) => {
    const type = String(entry?.sourceTransactionType || "").toLowerCase();
    const sourceId = entry?.sourceTransactionId;

    if (!sourceId) {
      toast.info("This ledger line has no linked source document.");
      return;
    }

    const reason = window.prompt("Provide reason", `Correction from ledger ${account?.code || ""}`);
    if (!reason) return;

    setActingKey(`${entry._id}:reverse`);
    try {
      if (type === "rent_payment") {
        await adminRequests.put(`/rent-payments/reverse/${sourceId}`, { reason });
        toast.success("Receipt reversed successfully.");
      } else if (type === "tenant_invoice") {
        await deleteTenantInvoice(sourceId);
        toast.success("Invoice deleted and ledger reversed successfully.");
      } else {
        toast.info("Direct delete is not enabled for this source type yet. Use the source document workflow.");
        return;
      }
      await loadActivity();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to reverse source transaction"
      );
    } finally {
      setActingKey("");
    }
  };

  const submitReclassify = async (e) => {
    e.preventDefault();
    if (!reclassifyModal.entry?._id || !reclassifyModal.newAccountId) {
      toast.error("Select a destination ledger.");
      return;
    }

    setActingKey(`${reclassifyModal.entry._id}:reclassify`);
    try {
      await adminRequests.post(`/chart-of-accounts/activity/${reclassifyModal.entry._id}/reclassify`, {
        business: businessId,
        newAccountId: reclassifyModal.newAccountId,
        reason: reclassifyModal.reason || `Moved from ${account?.code} ${account?.name}`,
      });
      toast.success("Ledger line moved successfully.");
      setReclassifyModal({ open: false, entry: null, newAccountId: "", reason: "" });
      await loadActivity();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to move ledger line"
      );
    } finally {
      setActingKey("");
    }
  };

  const totalPages = Math.max(1, Math.ceil(rows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedRows = rows.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, rows.length]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const openSource = (entry) => {
    const type = String(entry?.sourceTransactionType || "").toLowerCase();
    const sourceId = entry?.sourceTransactionId;
    if (!sourceId) return;

    if (type === "rent_payment") {
      navigate(`/receipts/${sourceId}`);
      return;
    }

    if (type === "tenant_invoice") {
      navigate(`/invoices/rental/${sourceId}`);
      return;
    }

    toast.info("No direct source page is configured for this entry yet.");
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex-shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  onClick={() => navigate("/financial/chart-of-accounts")}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900"
                >
                  <FaArrowLeft size={10} />
                  Back
                </button>

                <div className="min-w-0">
                  <h1 className="truncate text-lg font-bold leading-tight text-slate-900">
                    {account?.code || "..."} {account?.name || "Ledger Activity"}
                  </h1>
                  <p className="truncate text-[11px] leading-tight text-slate-500">
                    Compact audit view for live postings and reversal history.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Opening</div>
                  <div className="text-sm font-bold leading-tight text-blue-900">{formatMoney(openingBalance)}</div>
                </div>
                <div className="rounded-md border border-green-200 bg-green-50 px-2.5 py-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-green-600">Entries</div>
                  <div className="text-sm font-bold leading-tight text-green-900">{rows.length}</div>
                </div>
                <div className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-600">Closing</div>
                  <div className="text-sm font-bold leading-tight text-orange-900">{formatMoney(closingBalance)}</div>
                </div>
                <button
                  onClick={loadActivity}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
                >
                  <FaSyncAlt className="text-[10px]" />
                  Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                  <FaFilter className="text-[10px]" />
                  Filters
                </div>

                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="h-8 rounded-md border border-gray-300 px-2.5 text-[11px] shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  title="From date"
                />

                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="h-8 rounded-md border border-gray-300 px-2.5 text-[11px] shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  title="To date"
                />

                <select
                  value={filters.direction}
                  onChange={(e) => setFilters((prev) => ({ ...prev, direction: e.target.value }))}
                  className="h-8 rounded-md border border-gray-300 bg-[#DDEFE1] px-2.5 text-[11px] text-gray-800 shadow-sm"
                >
                  <option value="all">All directions</option>
                  <option value="debit">Debits only</option>
                  <option value="credit">Credits only</option>
                </select>

                <label className="flex h-8 items-center gap-2 rounded-md border border-[#0B3B2E]/20 bg-white px-2.5 text-[11px] font-medium text-slate-700 shadow-sm">
                  <input
                    type="checkbox"
                    checked={filters.includeReversed}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        includeReversed: e.target.checked,
                      }))
                    }
                  />
                  Show reversals
                </label>

                <button
                  onClick={loadActivity}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                >
                  <FaFilter className="text-[10px]" />
                  Apply
                </button>

                <button
                  onClick={() => {
                    const now = new Date();
                    setFilters({
                      startDate: inputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
                      endDate: inputDate(now),
                      direction: "all",
                      includeReversed: false,
                    });
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                >
                  <FaRedoAlt className="text-[10px]" />
                  Reset
                </button>
              </div>
            </div>

            {loading ? (
              <div className="px-4 py-6 text-sm text-slate-600">Loading ledger activity...</div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[1500px] text-xs">
                  <thead>
                    <tr className={`${MILIK_GREEN} sticky top-0 z-10 text-white`}>
                      <th className="px-3 py-2 text-left font-semibold">Date</th>
                      <th className="px-3 py-2 text-left font-semibold">Reference</th>
                      <th className="px-3 py-2 text-left font-semibold">Type</th>
                      <th className="px-3 py-2 text-left font-semibold">Narration</th>
                      <th className="px-3 py-2 text-left font-semibold">Tenant / Unit</th>
                      <th className="px-3 py-2 text-right font-semibold">Debit</th>
                      <th className="px-3 py-2 text-right font-semibold">Credit</th>
                      <th className="px-3 py-2 text-right font-semibold">Running Balance</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="px-4 py-8 text-center text-slate-500">
                          No ledger entries found for the selected filters.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((entry) => {
                        const tenantName = entry?.tenant?.name || "-";
                        const unitLabel = entry?.unit?.unitNumber || entry?.unit?.name || "-";
                        const auditBadge = getAuditBadge(entry);
                        const canReverseSource =
                          canManage &&
                          !entry?.isReversalEntry &&
                          !entry?.isReversedOriginal &&
                          !entry?.reversedByEntry &&
                          ["rent_payment", "tenant_invoice"].includes(
                            String(entry?.sourceTransactionType || "").toLowerCase()
                          );

                        return (
                          <tr key={entry._id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                            <td className="whitespace-nowrap px-3 py-2">{formatDate(entry.transactionDate)}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">{entry.sourceTransactionId || entry._id}</div>
                              <div className="text-[11px] text-slate-500">
                                {entry.accountId?.code} {entry.accountId?.name}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              <div>{sourceLabel(entry)}</div>
                              <div className="text-[11px] text-slate-500">{getAuditCaption(entry)}</div>
                            </td>
                            <td className="min-w-[300px] px-3 py-2 text-slate-700">
                              <div>{entry.notes || entry.category || "-"}</div>
                              {entry?.auditLinkId && (
                                <div className="text-[11px] text-slate-500">Linked entry: {entry.auditLinkId}</div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">{tenantName}</div>
                              <div className="text-[11px] text-slate-500">{unitLabel}</div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900">
                              {String(entry.direction) === "debit" ? formatMoney(entry.amount) : "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900">
                              {String(entry.direction) === "credit" ? formatMoney(entry.amount) : "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900">
                              {formatMoney(entry.runningBalance)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${auditBadge.className}`}>
                                {auditBadge.label}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  onClick={() => openSource(entry)}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  Open Source
                                </button>
                                {canManage && !entry?.isReversalEntry && (
                                  <button
                                    onClick={() =>
                                      setReclassifyModal({
                                        open: true,
                                        entry,
                                        newAccountId: "",
                                        reason: `Move ${entry.accountId?.code || account?.code} to another ledger`,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                                  >
                                    <FaExchangeAlt />
                                    Move
                                  </button>
                                )}
                                {canReverseSource && (
                                  <button
                                    onClick={() => handleReverseOrDelete(entry)}
                                    disabled={actingKey === `${entry._id}:reverse`}
                                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                                  >
                                    <FaTrashAlt />
                                    {String(entry.sourceTransactionType).toLowerCase() === "tenant_invoice"
                                      ? "Delete"
                                      : "Reverse"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-2">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                <div className="font-semibold">
                  Showing <span className="font-bold text-slate-900">{paginatedRows.length > 0 ? startIndex + 1 : 0}</span> to{" "}
                  <span className="font-bold text-slate-900">{Math.min(endIndex, rows.length)}</span> of{" "}
                  <span className="font-bold text-slate-900">{rows.length}</span> ledger entries
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={safeCurrentPage === 1}
                    className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="font-semibold text-slate-700">
                    Page {safeCurrentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {reclassifyModal.open && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="bg-[#0B3B2E] px-5 py-4 text-white">
                <h3 className="text-lg font-bold">Move Ledger Line</h3>
                <p className="mt-1 text-sm text-emerald-100">
                  This creates a controlled reclassification entry instead of editing history directly.
                </p>
              </div>
              <form onSubmit={submitReclassify} className="space-y-4 p-5">
                <div>
                  <div className="text-sm text-slate-600">Current Ledger</div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {account?.code} {account?.name}
                  </div>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Move To</span>
                  <select
                    value={reclassifyModal.newAccountId}
                    onChange={(e) =>
                      setReclassifyModal((prev) => ({ ...prev, newAccountId: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                  >
                    <option value="">Select destination ledger</option>
                    {reclassifyOptions.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.code} - {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Reason</span>
                  <textarea
                    value={reclassifyModal.reason}
                    onChange={(e) => setReclassifyModal((prev) => ({ ...prev, reason: e.target.value }))}
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setReclassifyModal({ open: false, entry: null, newAccountId: "", reason: "" })}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actingKey === `${reclassifyModal.entry?._id}:reclassify`}
                    className="rounded-xl bg-[#FF8C00] px-4 py-2.5 font-semibold text-white hover:bg-[#e67e00] disabled:opacity-60"
                  >
                    {actingKey === `${reclassifyModal.entry?._id}:reclassify` ? "Moving..." : "Move Ledger Line"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default LedgerAccountActivity;