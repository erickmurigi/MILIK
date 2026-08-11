import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import {
  FaArrowLeft, FaExchangeAlt, FaFilter, FaRedoAlt,
  FaSyncAlt, FaTrashAlt, FaTimes, FaUndo, FaInfoCircle,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { deleteTenantInvoice, getChartOfAccounts } from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";
import { fmtDate } from "../../utils/dates";
import { formatMoney } from "../../utils/money";

const DEFAULT_PAGE_SIZE = 50;

const inputDate = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const accountCanManage = (user) => {
  if (!user) return false;
  if (user.superAdminAccess || user.adminAccess || user.isSystemAdmin) return true;
  const profile = String(user.profile || "").toLowerCase();
  if (["administrator", "accountant"].includes(profile)) return true;
  return String(user.moduleAccess?.accounts || "").toLowerCase() === "full access";
};

const sourceLabel = (entry) => {
  if (entry?.isReversalEntry)   return "Reversal Entry";
  if (entry?.isReversedOriginal) return "Reversed Original";
  const type = String(entry?.sourceTransactionType || "other").replace(/_/g, " ");
  return type.replace(/\b\w/g, (m) => m.toUpperCase());
};

const auditBadge = (entry) => {
  if (entry?.isReversalEntry)   return { label: "Reversal",  cls: "bg-blue-100 text-blue-700" };
  if (entry?.isReversedOriginal) return { label: "Reversed",  cls: "bg-amber-100 text-amber-700" };
  const st = String(entry?.status || "approved").toLowerCase();
  return { label: st.charAt(0).toUpperCase() + st.slice(1), cls: "bg-emerald-100 text-emerald-700" };
};

const shortRef = (id) => id ? String(id).slice(-8).toUpperCase() : "—";

// ─────────────────────────────────────────────
const LedgerAccountActivity = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { accountId } = useParams();

  const backRoute =
    location.pathname.startsWith("/carwash/")    ? "/carwash/chart-of-accounts"
    : location.pathname.startsWith("/hr/")       ? "/hr/chart-of-accounts"
    : location.pathname.startsWith("/sale/")     ? "/sale/chart-of-accounts"
    : location.pathname.startsWith("/accounts/") ? "/accounts/chart-of-accounts"
    : "/financial/chart-of-accounts";

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser    = useSelector(selectCurrentUser);

  const [account,        setAccount]        = useState(null);
  const [accounts,       setAccounts]       = useState([]);
  const [rows,           setRows]           = useState([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [loading,        setLoading]        = useState(false);
  const [refreshing,     setRefreshing]     = useState(false);
  const [actingKey,      setActingKey]      = useState("");
  const [pageSize,       setPageSize]       = useTabState(`${location.pathname}:pageSize`, DEFAULT_PAGE_SIZE);
  const [currentPage,    setCurrentPage]    = useTabState(`${location.pathname}:currentPage`, 1);

  const [filters, setFilters] = useTabState(`${location.pathname}:filters`, () => {
    const now = new Date();
    return {
      startDate:       inputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      endDate:         inputDate(now),
      direction:       "all",
      includeReversed: false,
    };
  });
  const [moveModal, setMoveModal] = useState({ open: false, entry: null, newAccountId: "", reason: "" });
  const [reverseModal, setReverseModal] = useState({ open: false, entry: null, reason: "", loading: false });

  const businessId  = currentCompany?._id || "";
  const canManage   =
    accountCanManage(currentUser) &&
    hasCompanyPermission(currentUser || {}, currentCompany, "journals", "reverse", "accounts");

  // Keep a stable ref to filters so loadActivity doesn't need filters in its deps
  // (prevents auto-fetch on every date keystroke — user must click Apply)
  const filtersRef = React.useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  // ── Load activity ──
  const loadActivity = useCallback(async (appliedFilters) => {
    if (!businessId || !accountId) return;
    const f = appliedFilters || filtersRef.current;
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ business: businessId });
      if (f.startDate)       params.append("startDate",       f.startDate);
      if (f.endDate)         params.append("endDate",         f.endDate);
      if (f.direction && f.direction !== "all") params.append("direction", f.direction);
      if (f.includeReversed) params.append("includeReversed", "true");

      const res     = await adminRequests.get(`/chart-of-accounts/${accountId}/activity?${params.toString()}`);
      const payload = res.data?.data || {};
      setAccount(payload.account || null);
      setRows(Array.isArray(payload.entries) ? payload.entries : []);
      setOpeningBalance(Number(payload.openingBalance || 0));
      setClosingBalance(Number(payload.closingBalance || 0));
      setCurrentPage(1);
    } catch (error) {
      toast.error(
        error?.response?.data?.error || error?.response?.data?.message ||
        error?.message || "Failed to load ledger activity"
      );
      setRows([]); setAccount(null); setOpeningBalance(0); setClosingBalance(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId, accountId]); // filtersRef.current used instead of filters to avoid auto-fetch on every keystroke

  useEffect(() => {
    setLoading(true);
    loadActivity();
  }, [loadActivity]); // eslint-disable-line

  // ── Update tab title once account name is known ──
  useEffect(() => {
    if (!account?.code || !account?.name) return;
    navigate(location.pathname, {
      state: { tabTitle: `${account.code} — ${account.name}` },
      replace: true,
    });
  }, [account?.code, account?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load accounts for Move dropdown ──
  useEffect(() => {
    if (!businessId) return;
    getChartOfAccounts({ business: businessId })
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => setAccounts([]));
  }, [businessId]);

  const reclassifyOptions = useMemo(() =>
    accounts.filter((a) => a?._id !== accountId && a?.isPosting !== false && !a?.isHeader),
    [accounts, accountId]
  );

  // ── Pagination ──
  const totalPages      = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage        = Math.min(currentPage, totalPages);
  const startIdx        = (safePage - 1) * pageSize;
  const paginatedRows   = rows.slice(startIdx, startIdx + pageSize);

  // ── Filter apply / reset ──
  const applyFilters = () => { loadActivity(filters); };
  const resetFilters = () => {
    const now = new Date();
    const fresh = {
      startDate:       inputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      endDate:         inputDate(now),
      direction:       "all",
      includeReversed: false,
    };
    setFilters(fresh);
    loadActivity(fresh);
  };

  // ── Reverse/delete source ──
  const handleReverseOrDelete = async (entry) => {
    const type     = String(entry?.sourceTransactionType || "").toLowerCase();
    const sourceId = entry?.sourceTransactionId;
    if (!sourceId) { toast.info("No linked source document."); return; }
    setReverseModal({ open: true, entry, reason: `Correction from ledger ${account?.code || ""}`, loading: false });
  };

  const handleReverseConfirm = async () => {
    const { entry } = reverseModal;
    const type     = String(entry?.sourceTransactionType || "").toLowerCase();
    const sourceId = entry?.sourceTransactionId;
    const reason = (reverseModal.reason || "").trim() || `Correction from ledger ${account?.code || ""}`;
    setReverseModal((prev) => ({ ...prev, loading: true }));
    setActingKey(`${entry._id}:reverse`);
    try {
      if (type === "rent_payment") {
        await adminRequests.put(`/rent-payments/reverse/${sourceId}`, { reason });
        toast.success("Receipt reversed.");
      } else if (type === "tenant_invoice") {
        await deleteTenantInvoice(sourceId);
        toast.success("Invoice deleted and ledger reversed.");
      } else {
        toast.info("Use the source document workflow to reverse this entry type.");
        return;
      }
      await loadActivity();
      window.dispatchEvent(new Event("invoicesUpdated"));
      setReverseModal({ open: false, entry: null, reason: "", loading: false });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || "Failed to reverse");
      setReverseModal((prev) => ({ ...prev, loading: false }));
    } finally {
      setActingKey("");
    }
  };

  // ── Move / reclassify ──
  const submitMove = async (e) => {
    e.preventDefault();
    if (!moveModal.entry?._id || !moveModal.newAccountId) { toast.error("Select a destination account."); return; }
    setActingKey(`${moveModal.entry._id}:move`);
    try {
      await adminRequests.post(`/chart-of-accounts/activity/${moveModal.entry._id}/reclassify`, {
        business:     businessId,
        newAccountId: moveModal.newAccountId,
        reason:       moveModal.reason || `Moved from ${account?.code} ${account?.name}`,
      });
      toast.success("Ledger line moved.");
      setMoveModal({ open: false, entry: null, newAccountId: "", reason: "" });
      await loadActivity();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || "Failed to move");
    } finally {
      setActingKey("");
    }
  };

  // ── Open source document ──
  const openSource = (entry) => {
    const type     = String(entry?.sourceTransactionType || "").toLowerCase();
    const sourceId = entry?.sourceTransactionId;
    if (!sourceId) { toast.info("No source document linked."); return; }

    // ── Property Management — per-record detail pages ──────────────────────
    if (type === "invoice" || type === "tenant_invoice") { navigate(`/invoices/rental/${sourceId}`);  return; }
    if (type === "rent_payment" || type === "receipt")   { navigate(`/receipts/${sourceId}`);          return; }

    // ── Property Management — list pages (no per-record route) ─────────────
    if (type === "invoice_note")                { navigate("/invoices/notes");                    return; }
    if (type === "late_penalty_batch")          { navigate("/invoices/late-penalties");           return; }
    if (type === "payment_voucher")             { navigate("/accounts/payment-vouchers");         return; }
    if (type === "landlord_receipt")            { navigate("/receipts/landlord");                 return; }
    if (type === "landlord_payment")            { navigate("/landlord-payments");                 return; }
    if (type === "processed_statement" || type === "processed_statement_payment") { navigate("/landlord/processed-statements"); return; }
    if (type === "recurring_deduction")         { navigate("/landlords/standing-orders");         return; }
    if (type === "tenant_take_on_balance")      { navigate("/billing/take-on");                   return; }
    if (type === "lease_agreement_fee")         { navigate("/invoices/rental");                   return; }

    // ── Carwash — per-record ───────────────────────────────────────────────
    if (type === "carwash_loyalty_redemption")  { navigate(`/carwash/jobs/${sourceId}/edit`);    return; }

    // ── Carwash — list pages ───────────────────────────────────────────────
    if (type === "carwash_payment")             { navigate("/carwash/payments");                  return; }
    if (type === "carwash_expense")             { navigate("/carwash/expenses");                  return; }
    if (type === "carwash_commission")          { navigate("/carwash/commissions");               return; }
    if (type === "carwash_commission_payout")   { navigate("/carwash/commissions/payouts");       return; }
    if (["carwash_prepaid_topup", "carwash_credit_applied", "carwash_credit_refund", "carwash_credit_writeoff"].includes(type)) {
      navigate("/carwash/customers"); return;
    }

    toast.info(`No page configured for source type "${type}"`);
  };

  const sourcePageLabel = (entry) => {
    const type = String(entry?.sourceTransactionType || "").toLowerCase();
    // Types with a per-record detail page — label as "Open"
    if (["invoice", "tenant_invoice", "rent_payment", "receipt", "carwash_loyalty_redemption"].includes(type)) return "Open";
    // List-page destinations — label with an arrow
    const listLabels = {
      invoice_note: "Notes", late_penalty_batch: "Penalties",
      payment_voucher: "Vouchers", landlord_receipt: "L. Receipts",
      landlord_payment: "L. Payments", processed_statement: "Statements",
      processed_statement_payment: "Statements", recurring_deduction: "Standing Orders",
      tenant_take_on_balance: "Take-on", lease_agreement_fee: "Invoices",
      carwash_payment: "Payments", carwash_expense: "Expenses",
      carwash_commission: "Commissions", carwash_commission_payout: "Payouts",
      carwash_prepaid_topup: "Customers", carwash_credit_applied: "Customers",
      carwash_credit_refund: "Customers", carwash_credit_writeoff: "Customers",
    };
    return listLabels[type] ? `→ ${listLabels[type]}` : "Source";
  };

  const inputCls  = "h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
  const labelCls  = "block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1";
  const panelInputCls = "w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* ── Page header strip ── */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 flex items-center gap-4">
          <button
            onClick={() => navigate(backRoute)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#0B3B2E]"
          >
            <FaArrowLeft size={10} /> Back
          </button>

          <div className="border-l border-slate-200 pl-4 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ledger Activity</p>
            <h1 className="text-sm font-black text-slate-900 truncate">
              {loading ? "Loading…" : account ? `${account.code} — ${account.name}` : "—"}
            </h1>
          </div>

          {/* Stats */}
          <div className="ml-auto flex items-center gap-2">
            <div className="border border-blue-200 bg-blue-50 px-3 py-1 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wider text-blue-500">Opening</p>
              <p className="text-xs font-black text-blue-900 tabular-nums">{formatMoney(openingBalance)}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-3 py-1 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Entries</p>
              <p className="text-xs font-black text-slate-800">{rows.length}</p>
            </div>
            <div className="border border-emerald-200 bg-emerald-50 px-3 py-1 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-600">Closing</p>
              <p className="text-xs font-black text-emerald-900 tabular-nums">{formatMoney(closingBalance)}</p>
            </div>
            <button
              onClick={() => loadActivity()}
              className="h-7 px-2.5 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex items-center"
            >
              <FaSyncAlt size={9} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))}
            className={inputCls}
            title="From date"
          />
          <span className="text-[10px] text-slate-400 font-semibold">to</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))}
            className={inputCls}
            title="To date"
          />
          <AppSelect
            value={filters.direction !== "all" ? filters.direction : ""}
            onChange={(v) => setFilters((p) => ({ ...p, direction: v ?? "all" }))}
            options={[
              { value: "debit", label: "Debits only" },
              { value: "credit", label: "Credits only" },
            ]}
            placeholder="All directions"
            size="sm"
            clearable
          />
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filters.includeReversed}
              onChange={(e) => setFilters((p) => ({ ...p, includeReversed: e.target.checked }))}
              className="text-[#0B3B2E]"
            />
            Show reversals
          </label>
          <button
            onClick={applyFilters}
            className="h-7 px-3 bg-[#FF8C00] hover:bg-[#e67e00] text-white text-xs font-bold flex items-center gap-1"
          >
            <FaFilter size={9} /> Apply
          </button>
          <button
            onClick={resetFilters}
            className="h-7 px-3 bg-[#0B3B2E] hover:bg-[#0A3127] text-white text-xs font-bold flex items-center gap-1"
          >
            <FaRedoAlt size={9} /> Reset
          </button>
        </div>

        {/* ── Table + pagination ── */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
              Loading ledger entries…
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full min-w-[1100px] text-[11px] border-collapse">
                <thead>
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10 whitespace-nowrap">Date</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Ref</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Transaction</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Narration</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Debit</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Credit</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Running Balance</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-slate-400 italic text-xs">
                        No ledger entries for the selected period and filters.
                      </td>
                    </tr>
                  ) : paginatedRows.map((entry) => {
                    const badge       = auditBadge(entry);
                    const isDebit     = String(entry.direction) === "debit";
                    const isCredit    = String(entry.direction) === "credit";
                    const balance     = Number(entry.runningBalance || 0);
                    const canReverse  =
                      canManage &&
                      !entry?.isReversalEntry &&
                      !entry?.isReversedOriginal &&
                      !entry?.reversedByEntry &&
                      ["rent_payment", "tenant_invoice"].includes(
                        String(entry?.sourceTransactionType || "").toLowerCase()
                      );

                    return (
                      <tr
                        key={entry._id}
                        className={`border-b border-gray-100 hover:bg-blue-50/40 ${
                          entry?.isReversalEntry   ? "bg-blue-50/40" :
                          entry?.isReversedOriginal ? "bg-amber-50/40" : ""
                        }`}
                      >
                        {/* Date */}
                        <td className="px-3 py-1 border-r border-gray-100 whitespace-nowrap text-slate-700 font-medium">
                          {fmtDate(entry.transactionDate)}
                        </td>

                        {/* Ref */}
                        <td className="px-3 py-1 border-r border-gray-100">
                          <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5">
                            {shortRef(entry.sourceTransactionId || entry._id)}
                          </span>
                        </td>

                        {/* Transaction type */}
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700 whitespace-nowrap">
                          {sourceLabel(entry)}
                        </td>

                        {/* Narration */}
                        <td className="px-3 py-1 border-r border-gray-100 max-w-xs text-slate-600">
                          <p className="truncate">{entry.displayNarration || entry.notes || entry.category || "—"}</p>
                          {(entry?.reversalOf || entry?.reversedByEntry) && (
                            <p className="text-[10px] text-slate-400 font-mono truncate">
                              {entry?.reversalOf ? `↩ reversal of ${shortRef(entry.reversalOf)}` : `↩ reversed by ${entry?.reversedByUserName || shortRef(entry.reversedByEntry)}`}
                            </p>
                          )}
                        </td>

                        {/* Debit */}
                        <td className="px-3 py-1 border-r border-gray-100 text-right tabular-nums font-semibold">
                          {isDebit
                            ? <span className="text-emerald-700">{formatMoney(entry.amount)}</span>
                            : <span className="text-slate-300">—</span>
                          }
                        </td>

                        {/* Credit */}
                        <td className="px-3 py-1 border-r border-gray-100 text-right tabular-nums font-semibold">
                          {isCredit
                            ? <span className="text-rose-600">{formatMoney(entry.amount)}</span>
                            : <span className="text-slate-300">—</span>
                          }
                        </td>

                        {/* Running balance */}
                        <td className={`px-3 py-1 border-r border-gray-100 text-right tabular-nums font-bold ${
                          balance < 0 ? "text-rose-600" : "text-slate-800"
                        }`}>
                          {formatMoney(balance)}
                        </td>

                        {/* Status badge */}
                        <td className="px-3 py-1 border-r border-gray-100">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-1">
                          <div className="flex items-center justify-end gap-1.5">
                            {entry.sourceTransactionId && (
                              <button
                                onClick={() => openSource(entry)}
                                title={`Source: ${entry.sourceTransactionType}`}
                                className="h-6 px-2 border border-slate-200 bg-white text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                {sourcePageLabel(entry)}
                              </button>
                            )}
                            {canManage && !entry?.isReversalEntry && (
                              <button
                                onClick={() => setMoveModal({
                                  open: true, entry, newAccountId: "",
                                  reason: `Move from ${account?.code} ${account?.name}`,
                                })}
                                className="h-6 px-2 bg-[#0B3B2E] hover:bg-[#0A3127] text-[10px] font-bold text-white flex items-center gap-1"
                              >
                                <FaExchangeAlt size={8} /> Move
                              </button>
                            )}
                            {canReverse && (
                              <button
                                onClick={() => handleReverseOrDelete(entry)}
                                disabled={actingKey === `${entry._id}:reverse`}
                                className="h-6 px-2 bg-rose-600 hover:bg-rose-700 text-[10px] font-bold text-white flex items-center gap-1 disabled:opacity-60"
                              >
                                <FaTrashAlt size={8} />
                                {String(entry.sourceTransactionType).toLowerCase() === "tenant_invoice" ? "Delete" : "Reverse"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Pagination footer ── */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">
              Showing{" "}
              <span className="text-slate-900 font-bold">{paginatedRows.length > 0 ? startIdx + 1 : 0}</span>
              {" "}–{" "}
              <span className="text-slate-900 font-bold">{Math.min(startIdx + pageSize, rows.length)}</span>
              {" "}of{" "}
              <span className="text-slate-900 font-bold">{rows.length}</span>
              {" "}entries
            </span>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-semibold">Per page:</span>
              <AppSelect
                value={pageSize}
                onChange={(v) => { setPageSize(Number(v ?? 25)); setCurrentPage(1); }}
                options={[25, 50, 100, 200].map((n) => ({ value: n, label: String(n) }))}
                size="sm"
              />
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="h-7 px-3 border border-slate-200 bg-white font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="font-semibold text-slate-700 px-1">Page {safePage} of {totalPages}</span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="h-7 px-3 border border-slate-200 bg-white font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* ── Move ledger line modal ── */}
        {moveModal.open && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg overflow-hidden border border-slate-200 bg-white shadow-2xl">
              {/* Header */}
              <div className="bg-[#0B3B2E] px-5 py-3 flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Reclassify</p>
                  <p className="text-sm font-bold text-white mt-0.5">Move Ledger Line</p>
                  <p className="text-[10px] text-emerald-200 mt-0.5">
                    Creates a controlled correction entry — no history is overwritten.
                  </p>
                </div>
                <button
                  onClick={() => setMoveModal({ open: false, entry: null, newAccountId: "", reason: "" })}
                  className="text-white/50 hover:text-white mt-0.5"
                >
                  <FaTimes size={14} />
                </button>
              </div>

              <form onSubmit={submitMove} className="p-5 space-y-4">
                {/* Current ledger */}
                <div>
                  <label className={labelCls}>From (Current Ledger)</label>
                  <div className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                    {account?.code} — {account?.name}
                  </div>
                </div>

                {/* Entry narration */}
                {moveModal.entry?.notes && (
                  <div>
                    <label className={labelCls}>Entry Narration</label>
                    <div className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 truncate">
                      {moveModal.entry.notes}
                    </div>
                  </div>
                )}

                {/* Destination */}
                <div>
                  <label className={labelCls}>Move To *</label>
                  <AppSelect
                    value={moveModal.newAccountId}
                    onChange={(v) => setMoveModal((p) => ({ ...p, newAccountId: v ?? "" }))}
                    options={reclassifyOptions.map((a) => ({ value: a._id, label: `${a.code} — ${a.name}` }))}
                    placeholder="Select destination account…"
                    size="md"
                    searchable
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className={labelCls}>Reason</label>
                  <textarea
                    value={moveModal.reason}
                    onChange={(e) => setMoveModal((p) => ({ ...p, reason: e.target.value }))}
                    rows={2}
                    className={`${panelInputCls} resize-none`}
                    placeholder="Why is this being reclassified?"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setMoveModal({ open: false, entry: null, newAccountId: "", reason: "" })}
                    className="flex-1 h-8 border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actingKey === `${moveModal.entry?._id}:move` || !moveModal.newAccountId}
                    className="flex-1 h-8 bg-[#FF8C00] hover:bg-[#e67e00] text-white text-xs font-bold disabled:opacity-50"
                  >
                    {actingKey === `${moveModal.entry?._id}:move` ? "Moving…" : "Move Ledger Line"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {reverseModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#0B3B2E] px-6 py-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <FaUndo className="text-white text-sm" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-base leading-tight">Reverse Ledger Entry</h2>
                <p className="text-white/60 text-xs mt-0.5">{sourceLabel(reverseModal.entry)}</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <FaInfoCircle className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">This will reverse the source document and post an offsetting ledger entry. This action cannot be undone.</p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Reason</label>
                <textarea
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  value={reverseModal.reason}
                  onChange={(e) => setReverseModal((prev) => ({ ...prev, reason: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReverseConfirm(); } }}
                  disabled={reverseModal.loading}
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button onClick={() => setReverseModal({ open: false, entry: null, reason: "", loading: false })} disabled={reverseModal.loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={handleReverseConfirm} disabled={reverseModal.loading} className="rounded-lg bg-red-600 hover:bg-red-700 px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60 flex items-center gap-2">
                {reverseModal.loading ? <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Reversing…</> : <><FaUndo className="text-xs" />Confirm Reversal</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default LedgerAccountActivity;
