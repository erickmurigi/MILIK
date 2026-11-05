import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyModule } from "../../utils/companyModules";
import { FaArrowLeft, FaExchangeAlt, FaRedoAlt, FaSyncAlt, FaTrashAlt, FaTimes, FaPrint } from "react-icons/fa";
import printTabularList from "../../utils/printList";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { deleteTenantInvoice, getChartOfAccounts } from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import MilikTable from "../../components/common/MilikTable";
import ListToolbar from "../../components/common/ListToolbar";
import { fmtDate } from "../../utils/dates";
import { formatMoney } from "../../utils/money";

const DEFAULT_PAGE_SIZE = 50;
const PRINT_LIMIT = 5000;

const inputDate = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthToDate = () => {
  const now = new Date();
  return { startDate: inputDate(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: inputDate(now), direction: "all", includeReversed: false, property: "" };
};

const accountCanManage = (user) => {
  if (!user) return false;
  if (user.superAdminAccess || user.adminAccess || user.isSystemAdmin) return true;
  const profile = String(user.profile || "").toLowerCase();
  if (["administrator", "accountant"].includes(profile)) return true;
  return String(user.moduleAccess?.accounts || "").toLowerCase() === "full access";
};

const errorText = (error, fallback) => error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback;

// Balances come signed to the account's normal side; show the amount and the side it actually sits on.
const DEBIT_NORMAL = new Set(["asset", "expense"]);
const sided = (type, value) => {
  const n = Number(value || 0);
  if (Math.abs(n) < 0.005) return formatMoney(0);
  const debitNormal = DEBIT_NORMAL.has(String(type || "").toLowerCase());
  return `${formatMoney(Math.abs(n))} ${(n >= 0) === debitNormal ? "Dr" : "Cr"}`;
};

const sourceLabel = (entry) => {
  if (entry?.isReversalEntry) return "Reversal Entry";
  if (entry?.isReversedOriginal) return "Reversed Original";
  const type = String(entry?.sourceTransactionType || "other").replace(/_/g, " ");
  return type.replace(/\b\w/g, (m) => m.toUpperCase());
};

const auditBadge = (entry) => {
  if (entry?.isReversalEntry) return { label: "Reversal", cls: "border-blue-200 bg-blue-50 text-blue-700" };
  if (entry?.isReversedOriginal) return { label: "Reversed", cls: "border-amber-200 bg-amber-50 text-amber-700" };
  const st = String(entry?.status || "approved").toLowerCase();
  return { label: st.charAt(0).toUpperCase() + st.slice(1), cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
};

const shortRef = (id) => (id ? String(id).slice(-8).toUpperCase() : "—");

// Where each kind of source document lives: [route, button label]. A function route opens the record itself.
const SOURCE_PAGES = {
  invoice: [(id) => `/invoices/rental/${id}`, "Open"],
  tenant_invoice: [(id) => `/invoices/rental/${id}`, "Open"],
  rent_payment: [(id) => `/receipts/${id}`, "Open"],
  receipt: [(id) => `/receipts/${id}`, "Open"],
  carwash_loyalty_redemption: [(id) => `/carwash/jobs/${id}/edit`, "Open"],
  invoice_note: ["/invoices/notes", "Notes"],
  late_penalty_batch: ["/invoices/late-penalties", "Penalties"],
  payment_voucher: ["/accounts/payment-vouchers", "Vouchers"],
  landlord_receipt: ["/receipts/landlord", "L. Receipts"],
  landlord_payment: ["/landlord-payments", "L. Payments"],
  processed_statement: ["/landlord/processed-statements", "Statements"],
  processed_statement_payment: ["/landlord/processed-statements", "Statements"],
  recurring_deduction: ["/landlords/standing-orders", "Standing Orders"],
  tenant_take_on_balance: ["/billing/take-on", "Take-on"],
  lease_agreement_fee: ["/invoices/rental", "Invoices"],
  petty_cash_disbursement: ["/accounts/petty-cash", "Petty Cash"],
  petty_cash_replenishment: ["/accounts/petty-cash", "Petty Cash"],
  carwash_payment: ["/carwash/payments", "Payments"],
  carwash_expense: ["/carwash/expenses", "Expenses"],
  carwash_commission: ["/carwash/commissions", "Commissions"],
  carwash_commission_payout: ["/carwash/commissions/payouts", "Payouts"],
  carwash_prepaid_topup: ["/carwash/customers", "Customers"],
  carwash_credit_applied: ["/carwash/customers", "Customers"],
  carwash_credit_refund: ["/carwash/customers", "Customers"],
  carwash_credit_writeoff: ["/carwash/customers", "Customers"],
};
const sourcePage = (entry) => SOURCE_PAGES[String(entry?.sourceTransactionType || "").toLowerCase()] || null;

const Stat = ({ label, value, tone = "text-slate-800" }) => (
  <span className="flex shrink-0 items-center gap-1 border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px]">
    <span className="font-semibold uppercase tracking-wide text-slate-500">{label}</span>
    <span className={`font-black tabular-nums ${tone}`}>{value}</span>
  </span>
);

const Modal = ({ title, subtitle, onClose, children }) => (
  <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
    <div className="w-full max-w-lg overflow-hidden border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between bg-[#0B3B2E] px-4 py-2.5">
        <div>
          <p className="text-sm font-bold text-white">{title}</p>
          {subtitle && <p className="mt-0.5 text-[10px] text-emerald-200">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="mt-0.5 text-white/60 hover:text-white"><FaTimes size={13} /></button>
      </div>
      {children}
    </div>
  </div>
);

const labelCls = "mb-1 block text-xs font-bold text-slate-900";
const boxCls = "border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700";
const textareaCls = "w-full resize-none border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

// ─────────────────────────────────────────────
const LedgerAccountActivity = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { accountId } = useParams();
  const dispatch = useDispatch();

  const backRoute =
    location.pathname.startsWith("/carwash/") ? "/carwash/chart-of-accounts"
    : location.pathname.startsWith("/hr/") ? "/hr/chart-of-accounts"
    : location.pathname.startsWith("/sale/") ? "/sale/chart-of-accounts"
    : location.pathname.startsWith("/accounts/") ? "/accounts/chart-of-accounts"
    : "/financial/chart-of-accounts";

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  // The Property filter only means something to companies with Property Management.
  const hasPM = hasCompanyModule(currentCompany, "propertyManagement");
  const properties = useSelector(selectAllProperties);
  const businessId = currentCompany?._id || "";
  const canManage = accountCanManage(currentUser) && hasCompanyPermission(currentUser || {}, currentCompany, "journals", "reverse", "accounts");

  const [data, setData] = useState(null); // { account, openingBalance, closingBalance, totals, count, pages, entries }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [actingKey, setActingKey] = useState("");
  const [pageSize, setPageSize] = useTabState(`${location.pathname}:pageSize`, DEFAULT_PAGE_SIZE);
  const [page, setPage] = useTabState(`${location.pathname}:currentPage`, 1);
  const [filters, setFilters] = useTabState(`${location.pathname}:filters`, monthToDate);
  const [moveAccounts, setMoveAccounts] = useState(null);
  const [moveModal, setMoveModal] = useState({ open: false, entry: null, newAccountId: "", reason: "" });
  const [reverseModal, setReverseModal] = useState({ open: false, entry: null, reason: "", loading: false });
  const requestRef = useRef(0);

  useEffect(() => {
    if (businessId && hasPM) dispatch(getProperties({ business: businessId }));
  }, [businessId, hasPM, dispatch]);

  // A Trial Balance or Income Statement drill-down arrives with the date range it needs reconciled; it wins over
  // any filters remembered for this tab. Trial Balance is cumulative (end date only); Income Statement is a period.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const tb = location.state?.trialBalanceDrillDown;
    const is = location.state?.incomeStatementDrillDown;
    if (tb?.endDate) setFilters({ ...monthToDate(), startDate: "", endDate: tb.endDate });
    else if (is?.startDate && is?.endDate) setFilters({ ...monthToDate(), startDate: is.startDate, endDate: is.endDate, property: is.propertyId || "" });
    if (tb?.endDate || (is?.startDate && is?.endDate)) {
      setPage(1);
      navigate(location.pathname, { replace: true, state: {} });
    }
    setReady(true);
  }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildParams = useCallback((f, extra = {}) => {
    const params = { business: businessId, ...extra };
    if (f.startDate) params.startDate = f.startDate;
    if (f.endDate) params.endDate = f.endDate;
    if (f.direction && f.direction !== "all") params.direction = f.direction;
    if (f.includeReversed) params.includeReversed = "true";
    if (f.property) params.property = f.property;
    return params;
  }, [businessId]);

  const filtersKey = useDebounce(JSON.stringify(filters), 400);
  const load = useCallback(async () => {
    if (!businessId || !accountId) return;
    const id = ++requestRef.current;
    setRefreshing(true);
    try {
      const res = await adminRequests.get(`/chart-of-accounts/${accountId}/activity`, {
        params: buildParams(JSON.parse(filtersKey), { page, limit: pageSize }),
      });
      if (id !== requestRef.current) return;
      const d = res.data?.data || null;
      // past the last page (entries were reversed or filtered away): go to the last page instead
      if (d && d.count > 0 && page > d.pages) { setPage(d.pages); return; }
      setData(d);
    } catch (error) {
      if (id !== requestRef.current) return;
      toast.error(errorText(error, "Failed to load ledger activity"));
      setData(null);
    } finally {
      if (id === requestRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [businessId, accountId, buildParams, filtersKey, page, pageSize]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  // a filter change goes back to page 1
  const firstFilters = useRef(true);
  useEffect(() => {
    if (firstFilters.current) { firstFilters.current = false; return; }
    setPage(1);
  }, [filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const account = data?.account || null;
  const rows = data?.entries || [];
  const directionFiltered = filters.direction === "debit" || filters.direction === "credit";

  useEffect(() => {
    if (!account?.code || !account?.name) return;
    navigate(location.pathname, { state: { tabTitle: `${account.code} — ${account.name}` }, replace: true });
  }, [account?.code, account?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const afterChange = async () => {
    await load();
    window.dispatchEvent(new Event("invoicesUpdated"));
  };

  // ── Reverse the source document ──
  const handleReverseConfirm = async () => {
    const { entry } = reverseModal;
    const type = String(entry?.sourceTransactionType || "").toLowerCase();
    const sourceId = entry?.sourceTransactionId;
    const reason = (reverseModal.reason || "").trim();
    if (reason.length < 5) { toast.error("Give a reason of at least 5 characters."); return; }
    setReverseModal((prev) => ({ ...prev, loading: true }));
    setActingKey(`${entry._id}:reverse`);
    try {
      if (type === "rent_payment") {
        await adminRequests.put(`/rent-payments/reverse/${sourceId}`, { reason });
        toast.success("Receipt reversed.");
      } else if (type === "tenant_invoice") {
        await deleteTenantInvoice(sourceId);
        toast.success("Invoice deleted and ledger reversed.");
      }
      setReverseModal({ open: false, entry: null, reason: "", loading: false });
      await afterChange();
    } catch (error) {
      toast.error(errorText(error, "Failed to reverse"));
      setReverseModal((prev) => ({ ...prev, loading: false }));
    } finally {
      setActingKey("");
    }
  };

  // ── Move / reclassify (the account list loads only when needed) ──
  const openMove = (entry) => {
    setMoveModal({ open: true, entry, newAccountId: "", reason: `Move from ${account?.code} ${account?.name}` });
    if (!moveAccounts) {
      getChartOfAccounts({ business: businessId })
        .then((list) => setMoveAccounts(Array.isArray(list) ? list : []))
        .catch(() => setMoveAccounts([]));
    }
  };
  const moveOptions = useMemo(
    () => (moveAccounts || [])
      .filter((a) => a?._id !== accountId && a?.isPosting !== false && !a?.isHeader && a?.isActive !== false)
      .map((a) => ({ value: a._id, label: `${a.code} — ${a.name}` })),
    [moveAccounts, accountId],
  );

  const submitMove = async (e) => {
    e.preventDefault();
    if (!moveModal.entry?._id || !moveModal.newAccountId) { toast.error("Select a destination account."); return; }
    setActingKey(`${moveModal.entry._id}:move`);
    try {
      await adminRequests.post(`/chart-of-accounts/activity/${moveModal.entry._id}/reclassify`, {
        business: businessId,
        newAccountId: moveModal.newAccountId,
        reason: moveModal.reason || `Moved from ${account?.code} ${account?.name}`,
      });
      toast.success("Ledger line moved.");
      setMoveModal({ open: false, entry: null, newAccountId: "", reason: "" });
      await afterChange();
    } catch (error) {
      toast.error(errorText(error, "Failed to move"));
    } finally {
      setActingKey("");
    }
  };

  const openSource = (entry) => {
    const target = sourcePage(entry);
    if (!target) { toast.info(`No page configured for "${entry?.sourceTransactionType}"`); return; }
    navigate(typeof target[0] === "function" ? target[0](entry.sourceTransactionId) : target[0]);
  };

  // Print every entry for the current filters, not just the page on screen.
  const handlePrint = async () => {
    if (!account) return;
    setPrinting(true);
    try {
      const res = await adminRequests.get(`/chart-of-accounts/${accountId}/activity`, {
        params: buildParams(filters, { page: 1, limit: PRINT_LIMIT }),
      });
      const d = res.data?.data || {};
      const all = d.entries || [];
      if (d.count > all.length) toast.warning(`Printing the latest ${all.length.toLocaleString()} of ${d.count.toLocaleString()} entries. Narrow the dates to print the rest.`);
      const dateRange = [filters.startDate && fmtDate(filters.startDate), filters.endDate && fmtDate(filters.endDate)].filter(Boolean).join(" – ");
      printTabularList({
        title: `${account.code} — ${account.name}`,
        subtitle: "Account Activity Statement",
        company: currentCompany,
        summary: [
          `Opening: ${sided(account.type, d.openingBalance)}`,
          `Debits: ${formatMoney(d.totals?.debit)}`,
          `Credits: ${formatMoney(d.totals?.credit)}`,
          `Closing: ${sided(account.type, d.closingBalance)}`,
          `${d.count} entr${d.count === 1 ? "y" : "ies"}`,
          dateRange,
        ].filter(Boolean).join("   ·   "),
        columns: [
          { label: "Date", value: (e) => fmtDate(e.transactionDate) },
          { label: "Ref", value: (e) => shortRef(e.sourceTransactionId || e._id) },
          { label: "Transaction", value: (e) => sourceLabel(e) },
          { label: "Narration", value: (e) => e.displayNarration || e.notes || e.category || "—" },
          { label: "Debit", value: (e) => (e.debit ? formatMoney(e.debit) : "—"), align: "right" },
          { label: "Credit", value: (e) => (e.credit ? formatMoney(e.credit) : "—"), align: "right" },
          ...(directionFiltered ? [] : [{ label: "Balance", value: (e) => sided(account.type, e.runningBalance), align: "right" }]),
          { label: "Status", value: (e) => auditBadge(e).label },
          { label: "Done By", value: (e) => e.createdByName || "" },
        ],
        rows: all,
      });
    } catch (error) {
      toast.error(errorText(error, "Failed to print"));
    } finally {
      setPrinting(false);
    }
  };

  const type = account?.type;
  const closing = Number(data?.closingBalance || 0);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">
        <ListToolbar>
          <ListToolbar.Button icon={FaArrowLeft} variant="outline" onClick={() => navigate(backRoute)}>Chart</ListToolbar.Button>
          <span className="max-w-[260px] shrink-0 truncate text-[11px] font-black text-slate-900" title={account ? `${account.code} — ${account.name}` : ""}>
            {account ? <><span className="font-mono text-slate-500">{account.code}</span> {account.name}</> : loading ? "Loading…" : "—"}
          </span>
          <ListToolbar.Divider />
          <ListToolbar.Input type="date" value={filters.startDate} onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))} title="From date" />
          <span className="shrink-0 text-[9px] font-semibold text-slate-400">to</span>
          <ListToolbar.Input type="date" value={filters.endDate} onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))} title="To date" />
          <AppSelect
            value={directionFiltered ? filters.direction : ""}
            onChange={(v) => setFilters((p) => ({ ...p, direction: v ?? "all" }))}
            options={[{ value: "debit", label: "Debits only" }, { value: "credit", label: "Credits only" }]}
            placeholder="Debits & credits"
            compact
            clearable
          />
          {hasPM && (
            <AppSelect
              value={filters.property}
              onChange={(v) => setFilters((p) => ({ ...p, property: v ?? "" }))}
              options={properties.map((p) => ({ value: p._id, label: p.propertyName || p.name }))}
              placeholder="All properties"
              searchable
              clearable
              compact
            />
          )}
          <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[10px] font-semibold text-slate-600" title="Show reversed entries and the entries that reversed them. Balances are the same either way.">
            <input type="checkbox" checked={filters.includeReversed} onChange={(e) => setFilters((p) => ({ ...p, includeReversed: e.target.checked }))} />
            Show reversals
          </label>
          <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={() => { setFilters(monthToDate()); setPage(1); }}>Reset</ListToolbar.Button>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {data && (
              <>
                <Stat label={filters.startDate ? `Opening ${fmtDate(filters.startDate)}` : "Opening"} value={sided(type, data.openingBalance)} />
                <Stat label="Debits" value={formatMoney(data.totals?.debit)} />
                <Stat label="Credits" value={formatMoney(data.totals?.credit)} />
                <Stat label={filters.endDate ? `Closing ${fmtDate(filters.endDate)}` : "Closing"} value={sided(type, closing)} tone={closing < -0.005 ? "text-rose-700" : "text-[#0B3B2E]"} />
              </>
            )}
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPrint} variant="outline" disabled={printing || !data?.count} onClick={handlePrint}>{printing ? "Preparing…" : "Print"}</ListToolbar.Button>
            <ListToolbar.Button variant="outline" onClick={load} title="Refresh">
              <FaSyncAlt size={9} className={refreshing ? "animate-spin" : ""} />
            </ListToolbar.Button>
          </div>
        </ListToolbar>

        {directionFiltered && (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-semibold text-amber-800">
            Showing {filters.direction}s only. Opening and closing balances still count every entry; running balances are hidden because they would skip the other side.
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <MilikTable
            columns={[
              { label: "Date" },
              { label: "Ref" },
              { label: "Transaction" },
              { label: "Narration" },
              { label: "Debit", align: "right" },
              { label: "Credit", align: "right" },
              { label: "Balance", align: "right" },
              { label: "Status" },
              { label: "Done By" },
            ]}
            rows={rows}
            rowKey="_id"
            loading={loading}
            empty="No ledger entries for the selected period and filters."
            minWidth="1200px"
            rowClassName={(entry) => (entry?.isReversalEntry ? "!bg-blue-50/40" : entry?.isReversedOriginal ? "!bg-amber-50/40" : "")}
            renderRow={(entry) => {
              const badge = auditBadge(entry);
              const balance = entry.runningBalance;
              return (
                <>
                  <td className="whitespace-nowrap border-r border-gray-100 px-3 py-1 font-medium text-slate-700">{fmtDate(entry.transactionDate)}</td>
                  <td className="border-r border-gray-100 px-3 py-1">
                    <span className="bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{shortRef(entry.sourceTransactionId || entry._id)}</span>
                  </td>
                  <td className="whitespace-nowrap border-r border-gray-100 px-3 py-1 text-slate-700">{sourceLabel(entry)}</td>
                  <td className="max-w-xs border-r border-gray-100 px-3 py-1 text-slate-600">
                    <p className="truncate" title={entry.displayNarration || ""}>{entry.displayNarration || entry.notes || entry.category || "—"}</p>
                    {(entry?.reversalOf || entry?.reversedByEntry) && (
                      <p className="truncate font-mono text-[10px] text-slate-400">
                        {entry?.reversalOf ? `↩ reversal of ${shortRef(entry.reversalOf)}` : `↩ reversed by ${entry?.reversedByUserName || shortRef(entry.reversedByEntry)}`}
                      </p>
                    )}
                  </td>
                  <td className="border-r border-gray-100 px-3 py-1 text-right font-semibold tabular-nums">
                    {entry.debit ? <span className="text-slate-900">{formatMoney(entry.debit)}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="border-r border-gray-100 px-3 py-1 text-right font-semibold tabular-nums">
                    {entry.credit ? <span className="text-slate-900">{formatMoney(entry.credit)}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`whitespace-nowrap border-r border-gray-100 px-3 py-1 text-right font-bold tabular-nums ${balance !== null && balance < -0.005 ? "text-rose-700" : "text-slate-800"}`}>
                    {balance === null ? <span className="text-slate-300">—</span> : sided(type, balance)}
                  </td>
                  <td className="border-r border-gray-100 px-3 py-1">
                    <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td className="whitespace-nowrap border-r border-gray-100 px-3 py-1 text-[10px] text-slate-600">{entry.createdByName || ""}</td>
                </>
              );
            }}
            renderActions={(entry) => {
              const target = entry.sourceTransactionId ? sourcePage(entry) : null;
              const canReverse = canManage && !entry?.isReversalEntry && !entry?.isReversedOriginal && !entry?.reversedByEntry
                && ["rent_payment", "tenant_invoice"].includes(String(entry?.sourceTransactionType || "").toLowerCase());
              return (
                <div className="flex items-center justify-end gap-1">
                  {target && (
                    <button type="button" onClick={() => openSource(entry)} title={`Source: ${entry.sourceTransactionType}`}
                      className="h-6 border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">
                      {target[1] === "Open" ? "Open" : `→ ${target[1]}`}
                    </button>
                  )}
                  {canManage && !entry?.isReversalEntry && !entry?.isReversedOriginal && (
                    <button type="button" onClick={() => openMove(entry)}
                      className="flex h-6 items-center gap-1 bg-[#0B3B2E] px-2 text-[10px] font-bold text-white hover:bg-[#0A3127]">
                      <FaExchangeAlt size={8} /> Move
                    </button>
                  )}
                  {canReverse && (
                    <button type="button" disabled={actingKey === `${entry._id}:reverse`}
                      onClick={() => setReverseModal({ open: true, entry, reason: "", loading: false })}
                      className="flex h-6 items-center gap-1 bg-rose-600 px-2 text-[10px] font-bold text-white hover:bg-rose-700 disabled:opacity-60">
                      <FaTrashAlt size={8} /> {String(entry.sourceTransactionType).toLowerCase() === "tenant_invoice" ? "Delete" : "Reverse"}
                    </button>
                  )}
                </div>
              );
            }}
          />

          <PaginationBar
            page={data?.page || page}
            pages={data?.pages || 1}
            total={data?.count || 0}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
            loading={refreshing}
            label="entries"
          />
        </div>

        {moveModal.open && (
          <Modal title="Move ledger line" subtitle="Posts a correcting entry; the original stays on record." onClose={() => setMoveModal({ open: false, entry: null, newAccountId: "", reason: "" })}>
            <form onSubmit={submitMove} className="space-y-3 p-4">
              <div>
                <label className={labelCls}>From</label>
                <div className={boxCls}>{account?.code} — {account?.name}</div>
              </div>
              <div>
                <label className={labelCls}>Line</label>
                <div className={`${boxCls} truncate`}>
                  {fmtDate(moveModal.entry?.transactionDate)} · {moveModal.entry?.debit ? `Dr ${formatMoney(moveModal.entry.debit)}` : `Cr ${formatMoney(moveModal.entry?.credit)}`}
                  {moveModal.entry?.displayNarration ? ` · ${moveModal.entry.displayNarration}` : ""}
                </div>
              </div>
              <div>
                <label className={labelCls}>Move to *</label>
                <AppSelect
                  value={moveModal.newAccountId}
                  onChange={(v) => setMoveModal((p) => ({ ...p, newAccountId: v ?? "" }))}
                  options={moveOptions}
                  placeholder={moveAccounts ? "Select destination account…" : "Loading accounts…"}
                  size="sm"
                  searchable
                />
              </div>
              <div>
                <label className={labelCls}>Reason</label>
                <textarea value={moveModal.reason} onChange={(e) => setMoveModal((p) => ({ ...p, reason: e.target.value }))} rows={2} className={textareaCls} />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button type="button" onClick={() => setMoveModal({ open: false, entry: null, newAccountId: "", reason: "" })}
                  className="h-7 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={actingKey === `${moveModal.entry?._id}:move` || !moveModal.newAccountId}
                  className="h-7 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                  {actingKey === `${moveModal.entry?._id}:move` ? "Moving…" : "Move line"}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {reverseModal.open && (
          <Modal title={String(reverseModal.entry?.sourceTransactionType).toLowerCase() === "tenant_invoice" ? "Delete invoice" : "Reverse receipt"}
            subtitle={sourceLabel(reverseModal.entry)} onClose={() => !reverseModal.loading && setReverseModal({ open: false, entry: null, reason: "", loading: false })}>
            <div className="space-y-3 p-4">
              <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This reverses the source document and posts an offsetting entry for every line it posted, not just this one. It can't be undone.
              </p>
              <div>
                <label className={labelCls}>Reason *</label>
                <textarea rows={3} autoFocus className={textareaCls} value={reverseModal.reason} disabled={reverseModal.loading}
                  onChange={(e) => setReverseModal((prev) => ({ ...prev, reason: e.target.value }))} placeholder="Why is this being reversed?" />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button type="button" disabled={reverseModal.loading} onClick={() => setReverseModal({ open: false, entry: null, reason: "", loading: false })}
                  className="h-7 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="button" disabled={reverseModal.loading || reverseModal.reason.trim().length < 5} onClick={handleReverseConfirm}
                  className="h-7 bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50">
                  {reverseModal.loading ? "Reversing…" : "Confirm"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
};

export default LedgerAccountActivity;
