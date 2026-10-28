import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntityCache } from "../../hooks/useEntityCache";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { selectAllProperties } from "../../redux/selectors";
import { toast } from "react-toastify";
import {
  FaArrowDown,
  FaArrowUp,
  FaBook,
  FaBoxOpen,
  FaCog,
  FaMoneyBillWave,
  FaPrint,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaWallet,
} from "react-icons/fa";
import { printPettyCashVoucher, printReplenishmentSummary } from "../../utils/printPettyCash";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import { getCachedChartOfAccounts } from "../../utils/chartOfAccountsCache";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyPermission } from "../../utils/permissions";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';
import { fmtDate } from "../../utils/dates";
import Modal from "../../components/common/Modal";
import CurrencyInput from "../../components/common/CurrencyInput";
import {
  approvePettyCashReplenishment,
  createPettyCashDisbursement,
  getPettyCashAccounts,
  getPettyCashLedger,
  postPettyCashReplenishment,
  rejectPettyCashReplenishment,
  requestPettyCashReplenishment,
  voidPettyCashDisbursement,
} from "../../redux/pettyCashApi";

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const Section = ({ title, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const FOOTER_VARIANTS = {
  default: "bg-[#0B3B2E] hover:bg-[#0A3127]",
  danger: "bg-red-600 hover:bg-red-700",
  amber: "bg-amber-600 hover:bg-amber-700",
};

const ModalFooter = ({ onCancel, submitting, submitLabel, savingLabel, formId, variant = "default" }) => (
  <div className="flex items-center justify-end gap-2">
    <button type="button" onClick={onCancel} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      Cancel
    </button>
    <button type="submit" form={formId} disabled={submitting}
      className={`inline-flex h-8 items-center gap-1.5 px-4 text-xs font-black text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${FOOTER_VARIANTS[variant] || FOOTER_VARIANTS.default}`}>
      {submitting ? savingLabel : submitLabel}
    </button>
  </div>
);

const DEFAULT_PAGE_SIZE = 25;

const CATEGORY_LABELS = {
  maintenance: "Maintenance & Repairs",
  cleaning: "Cleaning Supplies",
  security: "Security",
  transport: "Transport & Fuel",
  office_supplies: "Office Supplies",
  utilities: "Utilities (Common Areas)",
  garden: "Garden & Grounds",
  staff_welfare: "Staff Welfare",
  miscellaneous: "Miscellaneous",
};

const CATEGORY_COLORS = {
  maintenance: "bg-orange-100 text-orange-800",
  cleaning: "bg-sky-100 text-sky-800",
  security: "bg-red-100 text-red-800",
  transport: "bg-indigo-100 text-indigo-800",
  office_supplies: "bg-purple-100 text-purple-800",
  utilities: "bg-teal-100 text-teal-800",
  garden: "bg-green-100 text-green-800",
  staff_welfare: "bg-pink-100 text-pink-800",
  miscellaneous: "bg-gray-100 text-gray-700",
};

const STATUS_COLORS = {
  active: "bg-emerald-100 text-emerald-800",
  void: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  posted: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "void", label: "Void" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "posted", label: "Posted" },
  { value: "rejected", label: "Rejected" },
];

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Modal wrapper (preserves open prop) ─────────────────────────────────────
const PettyCashModal = ({ open, ...props }) => {
  if (!open) return null;
  return <Modal {...props} />;
};

// ─── Balance chip — neutral at rest; color is reserved for the genuine "running low" warning ──
const BalancePill = ({ account }) => {
  if (!account) return null;
  const balance = Number(account.currentBalance || 0);
  const floatAmt = Number(account.floatAmount || 0);
  const pct = floatAmt > 0 ? Math.min(100, (balance / floatAmt) * 100) : 0;
  const isLow = pct < 25;
  return (
    <span className={`shrink-0 flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-bold ${isLow ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700"}`}>
      <FaWallet size={9} />
      Balance: KES {fmt(balance)}
      {isLow && " (Low)"}
    </span>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
// A real cash register shows money out and money in together, chronologically, with a running
// balance — this page used to split that into two tabs (Disbursements / Replenishments), which
// made it hard to answer "does this box's balance match what I expect right now." It's now one
// unified ledger backed by getPettyCashLedger, which merges and sorts both server-side. Account
// setup (create/edit petty cash boxes) moved to its own page — PettyCashAccounts.jsx — since
// that's a different task from day-to-day transaction entry.
const PettyCash = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser = useSelector((s) => s.auth?.currentUser);
  const properties = useSelector(selectAllProperties);
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);

  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useTabState("/accounts/petty-cash:selectedAccountId", "");
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerAccount, setLedgerAccount] = useState(null);
  const [coas, setCoas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [glEntry, setGlEntry] = useState(null);

  // draft filters (apply on Search)
  const [draftSearch, setDraftSearch] = useState("");
  const [draftType, setDraftType] = useState("any");
  const [draftCategory, setDraftCategory] = useState("any");
  const [draftStatus, setDraftStatus] = useState("any");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  // applied filters
  const [search, setSearch] = useTabState("/accounts/petty-cash:search", "");
  const [filterType, setFilterType] = useTabState("/accounts/petty-cash:filterType", "any");
  const [filterCategory, setFilterCategory] = useTabState("/accounts/petty-cash:filterCategory", "any");
  const [filterStatus, setFilterStatus] = useTabState("/accounts/petty-cash:filterStatus", "any");
  const [filterFrom, setFilterFrom] = useTabState("/accounts/petty-cash:filterFrom", "");
  const [filterTo, setFilterTo] = useTabState("/accounts/petty-cash:filterTo", "");

  // Modals
  const [showNewDisbursement, setShowNewDisbursement] = useState(false);
  const [showReplenishment, setShowReplenishment] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pageSize, setPageSize] = useTabState("/accounts/petty-cash:pageSize", DEFAULT_PAGE_SIZE);
  const [page, setPage] = useTabState("/accounts/petty-cash:page", 1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const canCreate  = hasCompanyPermission(currentUser, currentCompany, "pettyCash", "create", "accounts");
  const canApprove = hasCompanyPermission(currentUser, currentCompany, "pettyCash", "approve", "accounts");

  const businessId = currentCompany?._id;

  const _uid = currentUser?._id || currentUser?.id;
  const _pcDisbDraftKey = (businessId && _uid) ? `milik:draft:pc-disb:${businessId}:${_uid}` : null;
  const _pcRepDraftKey = (businessId && _uid) ? `milik:draft:pc-rep:${businessId}:${_uid}` : null;
  const _pcDisbDraftRestored = useRef(false);
  const _pcRepDraftRestored = useRef(false);

  // A ?account= link (e.g. "View Ledger" from the Accounts page) selects that account once.
  const _accountParamApplied = useRef(false);
  useEffect(() => {
    if (_accountParamApplied.current) return;
    const fromUrl = searchParams.get("account");
    if (fromUrl) { setSelectedAccountId(fromUrl); _accountParamApplied.current = true; }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load COAs + properties
  useEffect(() => {
    if (!businessId) return;
    if (!propertiesLoaded) dispatch(getProperties({ business: businessId }));
    getCachedChartOfAccounts(businessId)
      .then((list) => setCoas(list.filter((a) => !a.isHeader && a.active !== false && a.isActive !== false)))
      .catch(() => {});
  }, [businessId, dispatch]);

  const loadAccounts = useCallback(async () => {
    if (!businessId) return;
    try {
      const data = await getPettyCashAccounts({ business: businessId });
      setAccounts(data);
      if (data.length > 0 && !selectedAccountId) setSelectedAccountId(String(data[0]._id));
    } catch { /* silent */ }
  }, [businessId, selectedAccountId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const loadLedger = useCallback(async () => {
    if (!businessId || !selectedAccountId) return;
    setLoading(true);
    try {
      const res = await getPettyCashLedger(selectedAccountId, {
        business: businessId,
        type: filterType !== "any" ? filterType : undefined,
        category: filterCategory !== "any" ? filterCategory : undefined,
        status: filterStatus !== "any" ? filterStatus : undefined,
        startDate: filterFrom || undefined,
        endDate: filterTo || undefined,
        search: search || undefined,
        page,
        limit: pageSize,
      });
      setLedgerRows(res.data);
      setTotal(res.total);
      setPages(res.pages);
      setLedgerAccount(res.account);
    } catch { toast.error("Failed to load petty cash ledger"); }
    finally { setLoading(false); }
  }, [businessId, selectedAccountId, filterType, filterCategory, filterStatus, filterFrom, filterTo, search, page, pageSize]);

  useEffect(() => { loadLedger(); }, [loadLedger]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => String(a._id) === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  // ── Apply / reset filters
  const applySearch = () => {
    setSearch(draftSearch);
    setFilterType(draftType);
    setFilterCategory(draftCategory);
    setFilterStatus(draftStatus);
    setFilterFrom(draftFrom);
    setFilterTo(draftTo);
    setPage(1);
  };
  const resetFilters = () => {
    setDraftSearch(""); setDraftType("any"); setDraftCategory("any"); setDraftStatus("any"); setDraftFrom(""); setDraftTo("");
    setSearch(""); setFilterType("any"); setFilterCategory("any"); setFilterStatus("any"); setFilterFrom(""); setFilterTo("");
    setPage(1);
  };

  // ── Account helpers
  const bankAccounts = useMemo(
    () => coas.filter((a) => String(a.type).toLowerCase() === "asset" && /cash|bank|m-?pesa|mobile|wallet|till/i.test(`${a.name} ${a.subGroup || ""}`)),
    [coas]
  );
  const expenseAccounts = useMemo(() => coas.filter((a) => a.isActive !== false && String(a.type).toLowerCase() === "expense"), [coas]);

  // ─── Disbursement form
  const today = new Date().toISOString().split("T")[0];
  const [disbForm, setDisbForm] = useState({ date: today, amount: "", description: "", category: "maintenance", propertyId: "", expenseAccountId: "", receiptAttached: false, receiptNote: "" });
  const handleCreateDisbursement = async (e) => {
    e.preventDefault();
    if (!disbForm.amount || Number(disbForm.amount) <= 0) return toast.error("Amount is required");
    if (!disbForm.description.trim()) return toast.error("Description is required");
    if (!disbForm.expenseAccountId) return toast.error("Expense account is required — it's where this disbursement posts to in the ledger");
    setSubmitting(true);
    try {
      const res = await createPettyCashDisbursement({ ...disbForm, business: businessId, pettyCashAccountId: selectedAccountId });
      toast.success(`Voucher ${res?.data?.voucherNumber || ""} recorded`);
      closeDisbModal();
      setDisbForm({ date: today, amount: "", description: "", category: "maintenance", propertyId: "", expenseAccountId: "", receiptAttached: false, receiptNote: "" });
      setPage(1);
      await Promise.all([loadLedger(), loadAccounts()]);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  useEffect(() => {
    if (!_pcDisbDraftKey || _pcDisbDraftRestored.current) return;
    _pcDisbDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_pcDisbDraftKey);
      if (raw) { const { form: s } = JSON.parse(raw); if (s) { setDisbForm(s); setShowNewDisbursement(true); } }
    } catch {}
  }, [_pcDisbDraftKey]);

  useEffect(() => {
    if (!_pcDisbDraftKey || !_pcDisbDraftRestored.current || !showNewDisbursement) return;
    try { window.sessionStorage.setItem(_pcDisbDraftKey, JSON.stringify({ form: disbForm })); } catch {}
  }, [_pcDisbDraftKey, disbForm, showNewDisbursement]);

  // ─── Replenishment form
  const suggestedAmount = selectedAccount
    ? Math.max(0, Number(selectedAccount.floatAmount) - Number(selectedAccount.currentBalance))
    : 0;
  const [repForm, setRepForm] = useState({ amount: "", bankAccountId: "", notes: "" });
  useEffect(() => {
    if (showReplenishment) setRepForm((p) => ({ ...p, amount: suggestedAmount > 0 ? String(suggestedAmount) : "" }));
  }, [showReplenishment, suggestedAmount]);

  useEffect(() => {
    if (!_pcRepDraftKey || _pcRepDraftRestored.current) return;
    _pcRepDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_pcRepDraftKey);
      if (raw) {
        const { form: s } = JSON.parse(raw);
        if (s) { setRepForm((p) => ({ ...p, bankAccountId: s.bankAccountId || "", notes: s.notes || "" })); setShowReplenishment(true); }
      }
    } catch {}
  }, [_pcRepDraftKey]);

  useEffect(() => {
    if (!_pcRepDraftKey || !_pcRepDraftRestored.current || !showReplenishment) return;
    try { window.sessionStorage.setItem(_pcRepDraftKey, JSON.stringify({ form: repForm })); } catch {}
  }, [_pcRepDraftKey, repForm, showReplenishment]);

  const handleRequestReplenishment = async (e) => {
    e.preventDefault();
    if (!repForm.amount || Number(repForm.amount) <= 0) return toast.error("Amount is required");
    if (!repForm.bankAccountId) return toast.error("Funding bank account is required");
    setSubmitting(true);
    try {
      await requestPettyCashReplenishment({ ...repForm, business: businessId, pettyCashAccountId: selectedAccountId });
      toast.success("Replenishment request submitted");
      closeRepModal();
      setRepForm({ amount: "", bankAccountId: "", notes: "" });
      setPage(1);
      await loadLedger();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  // ─── Void
  const [voidReason, setVoidReason] = useState("");
  const handleVoid = async () => {
    if (!showVoidModal) return;
    setSubmitting(true);
    try {
      await voidPettyCashDisbursement(showVoidModal._id, { business: businessId, voidReason });
      toast.success("Disbursement voided");
      setShowVoidModal(null); setVoidReason("");
      await Promise.all([loadLedger(), loadAccounts()]);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  // ─── Approve replenishment
  const handleApproveReplenishment = async (repId) => {
    setSubmitting(true);
    try {
      await approvePettyCashReplenishment(repId, { business: businessId });
      toast.success("Replenishment approved");
      await loadLedger();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  // ─── Post replenishment
  const handlePostReplenishment = async (repId) => {
    setSubmitting(true);
    try {
      await postPettyCashReplenishment(repId, { business: businessId });
      toast.success("Replenishment posted to ledger");
      await Promise.all([loadLedger(), loadAccounts()]);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  // ─── Reject replenishment
  const [rejectReason, setRejectReason] = useState("");
  const handleReject = async () => {
    if (!showRejectModal) return;
    setSubmitting(true);
    try {
      await rejectPettyCashReplenishment(showRejectModal._id, { business: businessId, rejectionReason: rejectReason });
      toast.success("Replenishment rejected");
      setShowRejectModal(null); setRejectReason("");
      await loadLedger();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const closeDisbModal = () => {
    if (_pcDisbDraftKey) { try { window.sessionStorage.removeItem(_pcDisbDraftKey); } catch {} }
    setShowNewDisbursement(false);
  };
  const closeRepModal = () => {
    if (_pcRepDraftKey) { try { window.sessionStorage.removeItem(_pcRepDraftKey); } catch {} }
    setShowReplenishment(false);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">

            {/* ── Sticky toolbar ───────────────────────────────────────────── */}
            <ListToolbar>
              <FaWallet size={10} className="shrink-0 text-slate-400" />
              <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">Petty Cash Ledger</span>
              {accounts.length > 0 && (
                <AppSelect
                  value={selectedAccountId}
                  onChange={(v) => { setSelectedAccountId(v ?? ""); setPage(1); }}
                  options={accounts.map((a) => ({ value: String(a._id), label: a.name }))}
                  searchable
                  clearable
                  compact
                />
              )}
              {selectedAccount && <BalancePill account={selectedAccount} />}
              {selectedAccount && (
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                  Float: KES {fmt(selectedAccount.floatAmount)}
                </span>
              )}
              {selectedAccount?.custodianName && (
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                  Custodian: <span className="font-normal text-slate-500">{selectedAccount.custodianName}</span>
                </span>
              )}
              {total > 0 && (
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                  {total} transaction{total !== 1 ? "s" : ""}
                </span>
              )}

              <ListToolbar.Divider />
              <div className="relative shrink-0">
                <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
                <ListToolbar.Input
                  type="text"
                  placeholder="Search ref no., description…"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applySearch()}
                  width="w-44"
                  className="pl-6"
                />
              </div>
              <AppSelect
                value={draftType !== "any" ? draftType : ""}
                onChange={(v) => setDraftType(v ?? "any")}
                options={[{ value: "disbursement", label: "Expenses" }, { value: "replenishment", label: "Top-ups" }]}
                placeholder="All Types"
                clearable
                compact
              />
              <AppSelect
                value={draftCategory !== "any" ? draftCategory : ""}
                onChange={(v) => setDraftCategory(v ?? "any")}
                options={Object.entries(CATEGORY_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                placeholder="Category"
                searchable
                clearable
                compact
              />
              <AppSelect
                value={draftStatus !== "any" ? draftStatus : ""}
                onChange={(v) => setDraftStatus(v ?? "any")}
                options={STATUS_OPTIONS}
                placeholder="Status"
                clearable
                compact
              />
              <ListToolbar.Input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} title="From date" />
              <ListToolbar.Input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} title="To date" />
              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaSearch} variant="accent" onClick={applySearch}>Search</ListToolbar.Button>
              <ListToolbar.Button icon={FaRedoAlt} onClick={resetFilters}>Reset</ListToolbar.Button>
              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaCog} variant="outline" onClick={() => navigate("/accounts/petty-cash/accounts")}>
                Manage Accounts
              </ListToolbar.Button>
              {selectedAccountId && (
                <>
                  <ListToolbar.Divider />
                  <ListToolbar.Button
                    icon={FaMoneyBillWave}
                    className="!border !border-amber-300 !bg-amber-50 !text-amber-800 hover:!bg-amber-100"
                    disabled={!canCreate}
                    onClick={() => setShowReplenishment(true)}
                  >
                    Replenish
                  </ListToolbar.Button>
                  <ListToolbar.Button icon={FaPlus} disabled={!canCreate} onClick={() => setShowNewDisbursement(true)}>
                    Record Disbursement
                  </ListToolbar.Button>
                </>
              )}
            </ListToolbar>

            {/* ── Scrollable body ───────────────────────────────────────────── */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {accounts.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-24 text-center">
                  <FaBoxOpen className="mb-3 text-5xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">No petty cash accounts yet</p>
                  <p className="mt-1 text-xs text-slate-400">Set one up to start tracking petty cash</p>
                  {canCreate && (
                    <button
                      onClick={() => navigate("/accounts/petty-cash/accounts")}
                      className="mt-5 inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127]"
                    >
                      <FaPlus size={10} /> Create Account
                    </button>
                  )}
                </div>
              ) : (

                /* ── Unified ledger: disbursements (money out) + replenishments (money in) ── */
                <MilikTable
                  columns={[
                    { label: "Type", align: "center" },
                    { label: "Date" },
                    { label: "Ref No." },
                    { label: "Description" },
                    { label: "Category" },
                    { label: "Money Out (KES)", align: "right" },
                    { label: "Money In (KES)", align: "right" },
                    { label: "Balance (KES)", align: "right" },
                    { label: "Status", align: "center" },
                  ]}
                  rows={ledgerRows}
                  rowKey="_id"
                  loading={loading && ledgerRows.length === 0}
                  empty="No transactions found"
                  rowClassName={(row) => (row.status === "void" || row.status === "rejected") ? "opacity-40" : ""}
                  renderRow={(row) => (
                    <>
                      <td className="px-2 py-1 border-r border-gray-100 text-center">
                        {row.kind === "disbursement"
                          ? <FaArrowDown className="mx-auto text-red-500" size={10} title="Expense" />
                          : <FaArrowUp className="mx-auto text-emerald-600" size={10} title="Top-up" />}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{fmtDate(row.date)}</td>
                      <td className="px-3 py-1 border-r border-gray-100 font-mono font-semibold text-slate-700">{row.ref}</td>
                      <td className="max-w-[260px] px-3 py-1 border-r border-gray-100 text-slate-700">
                        <span className="line-clamp-1">{row.description}</span>
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        {row.kind === "disbursement" && row.category ? (
                          <span className={`inline-flex rounded-full border px-1.5 py-0 text-[9px] font-semibold ${CATEGORY_COLORS[row.category] || "bg-gray-100 text-gray-700 border-gray-200"}`}>
                            {CATEGORY_LABELS[row.category] || row.category}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-red-600">
                        {row.amountOut > 0 ? fmt(row.amountOut) : "—"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-emerald-600">
                        {row.amountIn > 0 ? fmt(row.amountIn) : "—"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-bold text-slate-800">{fmt(row.balanceAfter)}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-center">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[row.status] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                          {row.status}
                        </span>
                      </td>
                    </>
                  )}
                  renderActions={(row) => (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => row.kind === "disbursement"
                          ? printPettyCashVoucher({ disbursement: { ...row, voucherNumber: row.ref, amount: row.amountOut }, account: selectedAccount, company: currentCompany, user: currentUser })
                          : printReplenishmentSummary({ replenishment: { ...row, replenishmentNumber: row.ref, requestDate: row.date, amount: row.amountIn }, account: selectedAccount, company: currentCompany, user: currentUser })}
                        className="rounded px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
                        title="Print"
                      >
                        <FaPrint size={9} />
                      </button>
                      <button
                        onClick={() => setGlEntry({ data: row, sourceType: row.kind === "disbursement" ? "petty_cash_disbursement" : "petty_cash_replenishment" })}
                        className="rounded p-1 text-teal-600 hover:bg-teal-50 hover:text-teal-800"
                        title="View GL Entries"
                      >
                        <FaBook size={10} />
                      </button>
                      {row.kind === "disbursement" && row.status === "active" && canApprove && (
                        <button
                          onClick={() => setShowVoidModal({ ...row, voucherNumber: row.ref, amount: row.amountOut })}
                          className="rounded px-2 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
                        >
                          Void
                        </button>
                      )}
                      {row.kind === "replenishment" && row.status === "pending" && canApprove && (
                        <>
                          <button
                            disabled={submitting}
                            onClick={() => handleApproveReplenishment(row._id)}
                            className="rounded px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            disabled={submitting}
                            onClick={() => setShowRejectModal({ ...row, replenishmentNumber: row.ref, amount: row.amountIn })}
                            className="rounded px-2 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {row.kind === "replenishment" && row.status === "approved" && canApprove && (
                        <button
                          disabled={submitting}
                          onClick={() => handlePostReplenishment(row._id)}
                          className="rounded px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          Post
                        </button>
                      )}
                    </div>
                  )}
                />
              )}
            </div>

            {/* ── Pagination ──────────────────────────────────────────────── */}
            {total > 0 && (
              <PaginationBar
                page={page}
                pages={pages}
                total={total}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
                loading={loading}
                label="transactions"
              />
            )}
          </div>
        </div>
      </div>

      {/* ═══ Modals ═══════════════════════════════════════════════════════════ */}

      {/* New Disbursement */}
      <PettyCashModal
        open={showNewDisbursement}
        title="Record Disbursement"
        onClose={() => closeDisbModal()}
        footer={<ModalFooter onCancel={() => closeDisbModal()} submitting={submitting} submitLabel="Record Disbursement" savingLabel="Saving…" formId="pc-disb-form" />}
      >
        <form id="pc-disb-form" onSubmit={handleCreateDisbursement} className="space-y-2.5">
          <Section title="Disbursement Details">
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>Date<Required /></label>
                  <input type="date" className={inputClass} value={disbForm.date} onChange={(e) => setDisbForm((p) => ({ ...p, date: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>Amount<Required /></label>
                  <CurrencyInput value={disbForm.amount} onChange={(e) => setDisbForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" inputClassName={inputClass.replace("px-2.5", "pl-10 pr-2.5")} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Description<Required /></label>
                <input className={inputClass} value={disbForm.description} onChange={(e) => setDisbForm((p) => ({ ...p, description: e.target.value }))} placeholder="What was this expense for?" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>Category<Required /></label>
                  <AppSelect
                    value={disbForm.category}
                    onChange={(v) => setDisbForm((p) => ({ ...p, category: v ?? "maintenance" }))}
                    options={Object.entries(CATEGORY_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                    searchable
                    size="sm"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={labelClass}>Property (optional)</label>
                  <AppSelect
                    value={disbForm.propertyId}
                    onChange={(v) => setDisbForm((p) => ({ ...p, propertyId: v ?? "" }))}
                    options={properties.map((p) => ({ value: String(p._id), label: p.propertyName }))}
                    placeholder="— None —"
                    searchable
                    clearable
                    size="sm"
                    className="w-full"
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Expense Account (GL)<Required /></label>
                <AppSelect
                  value={disbForm.expenseAccountId}
                  onChange={(v) => setDisbForm((p) => ({ ...p, expenseAccountId: v ?? "" }))}
                  options={expenseAccounts.map((a) => ({ value: String(a._id), label: `${a.code ? a.code + " — " : ""}${a.name}` }))}
                  placeholder="— Select account —"
                  searchable
                  clearable
                  size="sm"
                  className="w-full"
                />
              </div>
            </div>
          </Section>
          <Section title="Receipt">
            <div className="space-y-2.5">
              <label className="flex items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-1.5">
                <input type="checkbox" checked={disbForm.receiptAttached} onChange={(e) => setDisbForm((p) => ({ ...p, receiptAttached: e.target.checked }))} className="h-3.5 w-3.5 border-slate-300 text-[#0B3B2E]" />
                <span className="text-xs font-bold text-slate-700">Receipt attached</span>
              </label>
              {!disbForm.receiptAttached && (
                <div>
                  <label className={labelClass}>Reason (no receipt)</label>
                  <input className={inputClass} value={disbForm.receiptNote} onChange={(e) => setDisbForm((p) => ({ ...p, receiptNote: e.target.value }))} placeholder="e.g. Receipt lost, purchase below KES 200" />
                </div>
              )}
            </div>
          </Section>
        </form>
      </PettyCashModal>

      {/* Replenishment Request */}
      <PettyCashModal
        open={showReplenishment}
        title="Request Replenishment"
        onClose={() => closeRepModal()}
        footer={<ModalFooter onCancel={() => closeRepModal()} submitting={submitting} submitLabel="Submit Request" savingLabel="Submitting…" formId="pc-rep-form" variant="amber" />}
      >
        <form id="pc-rep-form" onSubmit={handleRequestReplenishment} className="space-y-2.5">
          {selectedAccount && (
            <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              <p className="font-bold text-amber-900">Current balance: KES {fmt(selectedAccount.currentBalance)}</p>
              <p className="text-amber-700">Float target: KES {fmt(selectedAccount.floatAmount)}</p>
              {suggestedAmount > 0 && <p className="mt-1 font-bold text-amber-800">Suggested top-up: KES {fmt(suggestedAmount)}</p>}
            </div>
          )}
          <Section title="Replenishment Details">
            <div className="space-y-2.5">
              <div>
                <label className={labelClass}>Amount to Top Up<Required /></label>
                <CurrencyInput value={repForm.amount} onChange={(e) => setRepForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" inputClassName={inputClass.replace("px-2.5", "pl-10 pr-2.5")} />
              </div>
              <div>
                <label className={labelClass}>Draw From (Bank Account)<Required /></label>
                <AppSelect
                  value={repForm.bankAccountId}
                  onChange={(v) => setRepForm((p) => ({ ...p, bankAccountId: v ?? "" }))}
                  options={bankAccounts.map((a) => ({ value: String(a._id), label: `${a.code ? a.code + " — " : ""}${a.name}` }))}
                  placeholder="— Select bank account —"
                  searchable
                  clearable
                  size="sm"
                  className="w-full"
                />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea className={`${inputClass.replace("h-7", "h-auto")} py-1.5`} rows={2} value={repForm.notes} onChange={(e) => setRepForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes for approver" />
              </div>
            </div>
          </Section>
        </form>
      </PettyCashModal>

      {/* Void Disbursement */}
      <PettyCashModal
        open={!!showVoidModal}
        title="Void Disbursement"
        onClose={() => { setShowVoidModal(null); setVoidReason(""); }}
        footer={<ModalFooter onCancel={() => { setShowVoidModal(null); setVoidReason(""); }} submitting={submitting} submitLabel="Void" savingLabel="Voiding…" formId="pc-void-form" variant="danger" />}
      >
        {showVoidModal && (
          <form id="pc-void-form" onSubmit={(e) => { e.preventDefault(); handleVoid(); }} className="space-y-2.5">
            <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs">
              <p className="font-bold text-red-900">{showVoidModal.voucherNumber} — KES {fmt(showVoidModal.amount)}</p>
              <p className="mt-0.5 text-red-700">{showVoidModal.description}</p>
              <p className="mt-2 text-red-600">This reverses the ledger entry and restores the balance. Cannot be undone.</p>
            </div>
            <div>
              <label className={labelClass}>Void Reason</label>
              <input className={inputClass} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason for voiding" />
            </div>
          </form>
        )}
      </PettyCashModal>

      {/* Reject Replenishment */}
      <PettyCashModal
        open={!!showRejectModal}
        title="Reject Replenishment"
        onClose={() => { setShowRejectModal(null); setRejectReason(""); }}
        footer={<ModalFooter onCancel={() => { setShowRejectModal(null); setRejectReason(""); }} submitting={submitting} submitLabel="Reject" savingLabel="Rejecting…" formId="pc-reject-form" variant="danger" />}
      >
        {showRejectModal && (
          <form id="pc-reject-form" onSubmit={(e) => { e.preventDefault(); handleReject(); }} className="space-y-2.5">
            <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs">
              <p className="font-bold text-red-900">{showRejectModal.replenishmentNumber} — KES {fmt(showRejectModal.amount)}</p>
            </div>
            <div>
              <label className={labelClass}>Rejection Reason</label>
              <input className={inputClass} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this being rejected?" />
            </div>
          </form>
        )}
      </PettyCashModal>

      <JournalEntriesDrawer
        open={!!glEntry}
        onClose={() => setGlEntry(null)}
        title={glEntry?.sourceType === "petty_cash_replenishment" ? "Petty Cash Replenishment" : "Petty Cash Disbursement"}
        transactionRef={glEntry?.data?.ref}
        date={glEntry ? fmtDate(glEntry.data.date) : ""}
        amount={glEntry?.data?.amountOut || glEntry?.data?.amountIn}
        status={glEntry?.data?.status}
        statusColors={(glEntry?.data?.status === "active" || glEntry?.data?.status === "posted") ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-700 border-slate-200"}
        contextFields={glEntry ? [
          { label: "Category", value: CATEGORY_LABELS[glEntry.data.category] },
          { label: "Description", value: glEntry.data.description },
          { label: "Requested By", value: glEntry.data.requestedBy?.name || glEntry.data.createdBy?.name },
        ].filter((f) => f.value) : []}
        businessId={currentCompany?._id}
        sourceType={glEntry?.sourceType}
        sourceId={glEntry?.data?._id}
      />

    </DashboardLayout>
  );
};

export default PettyCash;
