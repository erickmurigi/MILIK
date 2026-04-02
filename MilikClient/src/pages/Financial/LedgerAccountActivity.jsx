import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { FaArrowLeft, FaExchangeAlt, FaFilter, FaSyncAlt, FaTrashAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { deleteTenantInvoice, getChartOfAccounts } from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";

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
  const type = String(entry?.sourceTransactionType || "other").replace(/_/g, " ");
  return type.replace(/\b\w/g, (m) => m.toUpperCase());
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

  const today = new Date();
  const [filters, setFilters] = useState({
    startDate: inputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: inputDate(today),
    direction: "all",
    includeReversed: false,
  });

  const [reclassifyModal, setReclassifyModal] = useState({ open: false, entry: null, newAccountId: "", reason: "" });

  const businessId = currentCompany?._id || "";
  const canManage = accountCanManage(currentUser) && hasCompanyPermission(currentUser || {}, currentCompany, "ledger", "reverse", "accounts");

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
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-[1600px] space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <button
                  onClick={() => navigate("/financial/chart-of-accounts")}
                  className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                  <FaArrowLeft />
                  Back to Chart of Accounts
                </button>
                <h1 className="text-2xl font-bold text-slate-900">
                  {account?.code || "..."} {account?.name || "Ledger Activity"}
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Review debits, credits, running balances, and manage source transactions from the ledger safely.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={loadActivity}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <FaSyncAlt />
                  Refresh
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Opening Balance</div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(openingBalance)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Filtered Entries</div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Closing Balance</div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(closingBalance)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FaFilter />
              Filters
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</span>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Direction</span>
                <select
                  value={filters.direction}
                  onChange={(e) => setFilters((prev) => ({ ...prev, direction: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                >
                  <option value="all">All</option>
                  <option value="debit">Debits only</option>
                  <option value="credit">Credits only</option>
                </select>
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-300 px-3 py-2.5 md:mt-5">
                <input
                  type="checkbox"
                  checked={filters.includeReversed}
                  onChange={(e) => setFilters((prev) => ({ ...prev, includeReversed: e.target.checked }))}
                />
                <span className="text-sm font-medium text-slate-700">Include reversed</span>
              </label>
              <div className="md:mt-5">
                <button
                  onClick={loadActivity}
                  className="w-full rounded-xl bg-[#0B3B2E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#082d24]"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {loading ? (
              <div className="px-4 py-6 text-sm text-slate-600">Loading ledger activity...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1400px] w-full text-sm">
                  <thead className="bg-[#0B3B2E] text-white">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Reference</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Narration</th>
                      <th className="px-4 py-3 text-left">Tenant / Unit</th>
                      <th className="px-4 py-3 text-right">Debit</th>
                      <th className="px-4 py-3 text-right">Credit</th>
                      <th className="px-4 py-3 text-right">Running Balance</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
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
                      rows.map((entry) => {
                        const tenantName = entry?.tenant?.name || "-";
                        const unitLabel = entry?.unit?.unitNumber || entry?.unit?.name || "-";
                        const canReverseSource = canManage && ["rent_payment", "tenant_invoice"].includes(String(entry?.sourceTransactionType || "").toLowerCase());
                        return (
                          <tr key={entry._id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                            <td className="px-4 py-3 whitespace-nowrap">{formatDate(entry.transactionDate)}</td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-800">{entry.sourceTransactionId || entry._id}</div>
                              <div className="text-xs text-slate-500">{entry.accountId?.code} {entry.accountId?.name}</div>
                            </td>
                            <td className="px-4 py-3">{sourceLabel(entry)}</td>
                            <td className="px-4 py-3 min-w-[280px] text-slate-700">{entry.notes || entry.category || "-"}</td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-800">{tenantName}</div>
                              <div className="text-xs text-slate-500">{unitLabel}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">
                              {String(entry.direction) === "debit" ? formatMoney(entry.amount) : "-"}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">
                              {String(entry.direction) === "credit" ? formatMoney(entry.amount) : "-"}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900">{formatMoney(entry.runningBalance)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                                entry.status === "reversed"
                                  ? "bg-amber-100 text-amber-700"
                                  : entry.status === "approved"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-100 text-slate-700"
                              }`}>
                                {entry.status || "approved"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2 flex-wrap">
                                <button
                                  onClick={() => openSource(entry)}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  Open Source
                                </button>
                                {canManage && (
                                  <button
                                    onClick={() =>
                                      setReclassifyModal({
                                        open: true,
                                        entry,
                                        newAccountId: "",
                                        reason: `Move ${entry.accountId?.code || account?.code} to another ledger`,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                                  >
                                    <FaExchangeAlt />
                                    Move
                                  </button>
                                )}
                                {canReverseSource && (
                                  <button
                                    onClick={() => handleReverseOrDelete(entry)}
                                    disabled={actingKey === `${entry._id}:reverse`}
                                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                                  >
                                    <FaTrashAlt />
                                    {String(entry.sourceTransactionType).toLowerCase() === "tenant_invoice" ? "Delete" : "Reverse"}
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
                  <div className="mt-1 font-semibold text-slate-900">{account?.code} {account?.name}</div>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Move To</span>
                  <select
                    value={reclassifyModal.newAccountId}
                    onChange={(e) => setReclassifyModal((prev) => ({ ...prev, newAccountId: e.target.value }))}
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
