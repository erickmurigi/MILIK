import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntityCache } from "../../hooks/useEntityCache";
import { useDispatch, useSelector } from "react-redux";
import { selectAllProperties } from "../../redux/selectors";
import { toast } from "react-toastify";
import {
  FaBook,
  FaBoxOpen,
  FaCheck,
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
import { getChartOfAccounts } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyPermission } from "../../utils/permissions";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import { fmtDate } from "../../utils/dates";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";
import {
  approvePettyCashReplenishment,
  createPettyCashAccount,
  createPettyCashDisbursement,
  getPettyCashAccounts,
  getPettyCashDisbursements,
  getPettyCashReplenishments,
  postPettyCashReplenishment,
  rejectPettyCashReplenishment,
  requestPettyCashReplenishment,
  updatePettyCashAccount,
  voidPettyCashDisbursement,
} from "../../redux/pettyCashApi";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

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

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });



// ─── Modal wrapper (preserves open prop) ─────────────────────────────────────
const PettyCashModal = ({ open, ...props }) => {
  if (!open) return null;
  return <Modal {...props} />;
};

// ─── Balance pill ─────────────────────────────────────────────────────────────
const BalancePill = ({ account }) => {
  if (!account) return null;
  const balance = Number(account.currentBalance || 0);
  const floatAmt = Number(account.floatAmount || 0);
  const pct = floatAmt > 0 ? Math.min(100, (balance / floatAmt) * 100) : 0;
  const isLow = pct < 25;
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${isLow ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      <FaWallet size={10} />
      Balance: KES {fmt(balance)}
      {isLow && <span className="ml-1 text-red-500">(Low)</span>}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const PettyCash = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser = useSelector((s) => s.auth?.currentUser);
  const properties = useSelector(selectAllProperties);
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);

  const [activeTab, setActiveTab] = useTabState("/accounts/petty-cash:activeTab", "disbursements");
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useTabState("/accounts/petty-cash:selectedAccountId", "");
  const [disbursements, setDisbursements] = useState([]);
  const [replenishments, setReplenishments] = useState([]);
  const [coas, setCoas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [glEntry, setGlEntry] = useState(null);

  // draft filters (apply on Search)
  const [draftSearch, setDraftSearch] = useState("");
  const [draftCategory, setDraftCategory] = useState("any");
  const [draftStatus, setDraftStatus] = useState("any");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  // applied filters
  const [search, setSearch] = useTabState("/accounts/petty-cash:search", "");
  const [filterCategory, setFilterCategory] = useTabState("/accounts/petty-cash:filterCategory", "any");
  const [filterStatus, setFilterStatus] = useTabState("/accounts/petty-cash:filterStatus", "any");
  const [filterFrom, setFilterFrom] = useTabState("/accounts/petty-cash:filterFrom", "");
  const [filterTo, setFilterTo] = useTabState("/accounts/petty-cash:filterTo", "");

  // Modals
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showNewDisbursement, setShowNewDisbursement] = useState(false);
  const [showReplenishment, setShowReplenishment] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pageSize, setPageSize] = useTabState("/accounts/petty-cash:pageSize", DEFAULT_PAGE_SIZE);
  const [disbPage, setDisbPage] = useTabState("/accounts/petty-cash:disbPage", 1);
  const [repPage, setRepPage] = useTabState("/accounts/petty-cash:repPage", 1);
  const [disbTotal, setDisbTotal] = useState(0);
  const [disbPages, setDisbPages] = useState(1);
  const [repTotal, setRepTotal] = useState(0);
  const [repPages, setRepPages] = useState(1);

  const canCreate  = hasCompanyPermission(currentUser, currentCompany, "pettyCash", "create", "accounts");
  const canApprove = hasCompanyPermission(currentUser, currentCompany, "pettyCash", "approve", "accounts");

  const businessId = currentCompany?._id;

  const _uid = currentUser?._id || currentUser?.id;
  const _pcAccountDraftKey = (businessId && _uid) ? `milik:draft:pc-account:${businessId}:${_uid}` : null;
  const _pcDisbDraftKey = (businessId && _uid) ? `milik:draft:pc-disb:${businessId}:${_uid}` : null;
  const _pcRepDraftKey = (businessId && _uid) ? `milik:draft:pc-rep:${businessId}:${_uid}` : null;
  const _pcAccountDraftRestored = useRef(false);
  const _pcDisbDraftRestored = useRef(false);
  const _pcRepDraftRestored = useRef(false);

  // ── Load COAs + properties
  useEffect(() => {
    if (!businessId) return;
    if (!propertiesLoaded) dispatch(getProperties({ business: businessId }));
    getChartOfAccounts({ business: businessId })
      .then((res) => {
        const list = Array.isArray(res) ? res : res?.data || [];
        setCoas(list.filter((a) => !a.isHeader && a.active !== false && a.isActive !== false));
      })
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

  const loadTransactions = useCallback(async () => {
    if (!businessId || !selectedAccountId) return;
    setLoading(true);
    try {
      const [d, r] = await Promise.all([
        getPettyCashDisbursements({
          business: businessId,
          pettyCashAccountId: selectedAccountId,
          status: filterStatus !== "any" ? filterStatus : undefined,
          category: filterCategory !== "any" ? filterCategory : undefined,
          startDate: filterFrom || undefined,
          endDate: filterTo || undefined,
          search: search || undefined,
          page: disbPage,
          limit: pageSize,
        }),
        getPettyCashReplenishments({
          business: businessId,
          pettyCashAccountId: selectedAccountId,
          page: repPage,
          limit: pageSize,
        }),
      ]);
      setDisbursements(d.data ?? d);
      setDisbTotal(d.total ?? 0);
      setDisbPages(d.pages ?? 1);
      setReplenishments(r.data ?? r);
      setRepTotal(r.total ?? 0);
      setRepPages(r.pages ?? 1);
    } catch { toast.error("Failed to load transactions"); }
    finally { setLoading(false); }
  }, [businessId, selectedAccountId, filterStatus, filterCategory, filterFrom, filterTo, search, disbPage, repPage, pageSize]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => String(a._id) === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  // ── Apply / reset filters
  const applySearch = () => {
    setSearch(draftSearch);
    setFilterCategory(draftCategory);
    setFilterStatus(draftStatus);
    setFilterFrom(draftFrom);
    setFilterTo(draftTo);
    setDisbPage(1);
    setRepPage(1);
  };
  const resetFilters = () => {
    setDraftSearch(""); setDraftCategory("any"); setDraftStatus("any"); setDraftFrom(""); setDraftTo("");
    setSearch(""); setFilterCategory("any"); setFilterStatus("any"); setFilterFrom(""); setFilterTo("");
    setDisbPage(1);
    setRepPage(1);
  };

  // ── Filtered disbursements
  // Filters are now pushed server-side in loadTransactions — disbursements is already filtered
  const filteredDisbursements = disbursements;

  // Replenishments still filtered client-side (low volume, no server-side filter params yet)
  const filteredReplenishments = replenishments;

  // Server already paginates — these are direct aliases
  const pagedDisbursements = filteredDisbursements;
  const pagedReplenishments = filteredReplenishments;

  // ── Account helpers
  const bankAccounts = useMemo(
    () => coas.filter((a) => String(a.type).toLowerCase() === "asset" && /cash|bank|m-?pesa|mobile|wallet|till/i.test(`${a.name} ${a.subGroup || ""}`)),
    [coas]
  );
  const expenseAccounts = useMemo(() => coas.filter((a) => String(a.type).toLowerCase() === "expense"), [coas]);
  const assetAccounts = useMemo(() => coas.filter((a) => String(a.type).toLowerCase() === "asset"), [coas]);

  // ── Totals
  const activeDisbTotal = useMemo(
    () => filteredDisbursements.filter((d) => d.status === "active").reduce((s, d) => s + Number(d.amount || 0), 0),
    [filteredDisbursements]
  );
  const pendingRepTotal = useMemo(
    () => replenishments.filter((r) => r.status === "pending").reduce((s, r) => s + Number(r.amount || 0), 0),
    [replenishments]
  );

  // ─── New Account form
  const [accountForm, setAccountForm] = useState({ name: "", custodianName: "", floatAmount: "", glAccountId: "", voucherPrefix: "PCV", notes: "" });
  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!accountForm.name.trim()) return toast.error("Account name is required");
    if (!accountForm.floatAmount || Number(accountForm.floatAmount) <= 0) return toast.error("Float amount must be greater than zero");
    setSubmitting(true);
    try {
      const created = await createPettyCashAccount({ ...accountForm, business: businessId });
      toast.success("Petty cash account created");
      closeAccountModal();
      setAccountForm({ name: "", custodianName: "", floatAmount: "", glAccountId: "", voucherPrefix: "PCV", notes: "" });
      await loadAccounts();
      setSelectedAccountId(String(created._id || created.data?._id || ""));
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  useEffect(() => {
    if (!_pcAccountDraftKey || _pcAccountDraftRestored.current) return;
    _pcAccountDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_pcAccountDraftKey);
      if (raw) { const { form: s } = JSON.parse(raw); if (s) { setAccountForm(s); setShowNewAccount(true); } }
    } catch {}
  }, [_pcAccountDraftKey]);

  useEffect(() => {
    if (!_pcAccountDraftKey || !_pcAccountDraftRestored.current || !showNewAccount) return;
    try { window.sessionStorage.setItem(_pcAccountDraftKey, JSON.stringify({ form: accountForm })); } catch {}
  }, [_pcAccountDraftKey, accountForm, showNewAccount]);

  // ─── Disbursement form
  const today = new Date().toISOString().split("T")[0];
  const [disbForm, setDisbForm] = useState({ date: today, amount: "", description: "", category: "maintenance", propertyId: "", expenseAccountId: "", receiptAttached: false, receiptNote: "" });
  const handleCreateDisbursement = async (e) => {
    e.preventDefault();
    if (!disbForm.amount || Number(disbForm.amount) <= 0) return toast.error("Amount is required");
    if (!disbForm.description.trim()) return toast.error("Description is required");
    setSubmitting(true);
    try {
      const res = await createPettyCashDisbursement({ ...disbForm, business: businessId, pettyCashAccountId: selectedAccountId });
      toast.success(`Voucher ${res?.data?.voucherNumber || ""} recorded`);
      closeDisbModal();
      setDisbForm({ date: today, amount: "", description: "", category: "maintenance", propertyId: "", expenseAccountId: "", receiptAttached: false, receiptNote: "" });
      await Promise.all([loadTransactions(), loadAccounts()]);
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
    setSubmitting(true);
    try {
      await requestPettyCashReplenishment({ ...repForm, business: businessId, pettyCashAccountId: selectedAccountId });
      toast.success("Replenishment request submitted");
      closeRepModal();
      setRepForm({ amount: "", bankAccountId: "", notes: "" });
      await loadTransactions();
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
      await Promise.all([loadTransactions(), loadAccounts()]);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  // ─── Approve replenishment
  const handleApproveReplenishment = async (repId) => {
    setSubmitting(true);
    try {
      await approvePettyCashReplenishment(repId, { business: businessId });
      toast.success("Replenishment approved");
      await loadTransactions();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  // ─── Post replenishment
  const handlePostReplenishment = async (repId) => {
    setSubmitting(true);
    try {
      await postPettyCashReplenishment(repId, { business: businessId });
      toast.success("Replenishment posted to ledger");
      await Promise.all([loadTransactions(), loadAccounts()]);
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
      await loadTransactions();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const closeAccountModal = () => {
    if (_pcAccountDraftKey) { try { window.sessionStorage.removeItem(_pcAccountDraftKey); } catch {} }
    setShowNewAccount(false);
  };
  const closeDisbModal = () => {
    if (_pcDisbDraftKey) { try { window.sessionStorage.removeItem(_pcDisbDraftKey); } catch {} }
    setShowNewDisbursement(false);
  };
  const closeRepModal = () => {
    if (_pcRepDraftKey) { try { window.sessionStorage.removeItem(_pcRepDraftKey); } catch {} }
    setShowReplenishment(false);
  };

  const pendingRepCount = replenishments.filter((r) => r.status === "pending").length;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">

            {/* ── Sticky toolbar ───────────────────────────────────────────── */}
            <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <span className="shrink-0 text-xs font-black text-slate-800">Petty Cash</span>
                {accounts.length > 0 && (
                  <AppSelect
                    value={selectedAccountId}
                    onChange={(v) => setSelectedAccountId(v ?? "")}
                    options={accounts.map((a) => ({ value: String(a._id), label: a.name }))}
                    searchable
                    clearable
                    size="sm"
                  />
                )}
                {selectedAccount && <BalancePill account={selectedAccount} />}
                {selectedAccount && (
                  <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    Float: KES {fmt(selectedAccount.floatAmount)}
                  </span>
                )}
                {selectedAccount?.custodianName && (
                  <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                    Custodian: <span className="font-semibold text-slate-700">{selectedAccount.custodianName}</span>
                  </span>
                )}
                {activeTab === "disbursements" && filteredDisbursements.length > 0 && (
                  <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    {filteredDisbursements.length} voucher{filteredDisbursements.length !== 1 ? "s" : ""} · KES {fmt(activeDisbTotal)}
                  </span>
                )}
                {activeTab === "replenishments" && pendingRepCount > 0 && (
                  <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    {pendingRepCount} pending · KES {fmt(pendingRepTotal)}
                  </span>
                )}
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                {[
                  { id: "disbursements", label: "Disbursements" },
                  { id: "replenishments", label: "Replenishments", badge: pendingRepCount },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); resetFilters(); setDisbPage(1); setRepPage(1); }}
                    className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold ${
                      activeTab === tab.id
                        ? "bg-[#0B3B2E] text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {tab.label}
                    {tab.badge > 0 && (
                      <span className="rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">{tab.badge}</span>
                    )}
                  </button>
                ))}
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <input
                  type="text"
                  placeholder={activeTab === "disbursements" ? "Search voucher, description…" : "Search ref no…"}
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applySearch()}
                  className="h-7 w-40 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
                {activeTab === "disbursements" && (
                  <AppSelect
                    value={draftCategory !== "any" ? draftCategory : ""}
                    onChange={(v) => setDraftCategory(v ?? "any")}
                    options={Object.entries(CATEGORY_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                    placeholder="Category"
                    searchable
                    clearable
                    size="sm"
                  />
                )}
                <AppSelect
                  value={draftStatus !== "any" ? draftStatus : ""}
                  onChange={(v) => setDraftStatus(v ?? "any")}
                  options={activeTab === "disbursements"
                    ? [{ value: "active", label: "Active" }, { value: "void", label: "Void" }]
                    : [{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "posted", label: "Posted" }, { value: "rejected", label: "Rejected" }]}
                  placeholder="Status"
                  clearable
                  size="sm"
                />
                <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} className="h-7 w-28 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" title="From date" />
                <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} className="h-7 w-28 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" title="To date" />
                <button onClick={applySearch} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}>
                  <FaSearch size={9} /> Search
                </button>
                <button onClick={resetFilters} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}>
                  <FaRedoAlt size={9} /> Reset
                </button>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <button
                  onClick={() => setShowNewAccount(true)}
                  disabled={!canCreate}
                  className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaPlus size={9} /> New Account
                </button>
                {selectedAccountId && (
                  <>
                    <button
                      onClick={() => setShowReplenishment(true)}
                      disabled={!canCreate}
                      className="h-7 shrink-0 flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaMoneyBillWave size={9} /> Replenish
                    </button>
                    <button
                      onClick={() => setShowNewDisbursement(true)}
                      disabled={!canCreate}
                      className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                    >
                      <FaPlus size={9} /> Record Disbursement
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* ── Scrollable body ───────────────────────────────────────────── */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {accounts.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-24 text-center">
                  <FaBoxOpen className="mb-3 text-5xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">No petty cash accounts yet</p>
                  <p className="mt-1 text-xs text-slate-400">Create your first account to start tracking petty cash</p>
                  {canCreate && (
                    <button
                      onClick={() => setShowNewAccount(true)}
                      className={`mt-5 flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                    >
                      <FaPlus /> Create Account
                    </button>
                  )}
                </div>
              ) : activeTab === "disbursements" ? (

                /* ── Disbursements table */
                <table className="min-w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Voucher No.</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Description</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Category</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount (KES)</th>
                      <th className="px-3 py-1 text-center font-bold border-r border-white/10">Receipt</th>
                      <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                      <th className="px-3 py-1 text-center font-bold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={9} className="py-16 text-center text-xs text-slate-400">Loading…</td></tr>
                    ) : filteredDisbursements.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-20 text-center">
                          <FaBoxOpen className="mx-auto mb-2 text-3xl text-slate-300" />
                          <p className="text-xs text-slate-400">No disbursements found</p>
                        </td>
                      </tr>
                    ) : pagedDisbursements.map((row, idx) => (
                      <tr
                        key={row._id}
                        className={`border-b border-gray-100 transition-colors hover:bg-blue-50/40 ${row.status === "void" ? "opacity-40" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}
                      >
                        <td className="px-3 py-1 border-r border-gray-100 font-mono font-semibold text-slate-700">{row.voucherNumber}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{fmtDate(row.date)}</td>
                        <td className="max-w-[220px] px-3 py-1 border-r border-gray-100 text-slate-700">
                          <span className="line-clamp-2">{row.description}</span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_COLORS[row.category] || "bg-gray-100 text-gray-700 border-gray-200"}`}>
                            {CATEGORY_LABELS[row.category] || row.category}
                          </span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{row.property?.propertyName || "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-slate-800">{fmt(row.amount)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center">
                          {row.receiptAttached
                            ? <FaCheck className="mx-auto text-emerald-600" size={10} />
                            : <span className="text-[10px] text-slate-400">{row.receiptNote ? "Noted" : "—"}</span>
                          }
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[row.status] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => printPettyCashVoucher({ disbursement: row, account: selectedAccount, company: currentCompany, user: currentUser })}
                              className="rounded px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
                              title="Print voucher"
                            >
                              <FaPrint size={9} />
                            </button>
                            <button
                              onClick={() => setGlEntry({ data: row, sourceType: "petty_cash_disbursement" })}
                              className="rounded p-1 text-teal-600 hover:bg-teal-50 hover:text-teal-800"
                              title="View GL Entries"
                            >
                              <FaBook size={10} />
                            </button>
                            {row.status === "active" && canApprove && (
                              <button
                                onClick={() => setShowVoidModal(row)}
                                className="rounded px-2 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
                              >
                                Void
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {filteredDisbursements.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50">
                        <td colSpan={5} className="px-4 py-2.5 font-semibold text-slate-600">
                          {filteredDisbursements.length} voucher{filteredDisbursements.length !== 1 ? "s" : ""}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-800">
                          {fmt(activeDisbTotal)}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  )}
                </table>

              ) : (

                /* ── Replenishments table */
                <table className="min-w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Ref No.</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Request Date</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Balance Before</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount (KES)</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Bank Account</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Requested By</th>
                      <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                      <th className="px-3 py-1 text-center font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={8} className="py-16 text-center text-xs text-slate-400">Loading…</td></tr>
                    ) : replenishments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-20 text-center">
                          <FaBoxOpen className="mx-auto mb-2 text-3xl text-slate-300" />
                          <p className="text-xs text-slate-400">No replenishments yet</p>
                        </td>
                      </tr>
                    ) : pagedReplenishments.map((row, idx) => (
                      <tr key={row._id} className={`border-b border-gray-100 transition-colors hover:bg-blue-50/40 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                        <td className="px-3 py-1 border-r border-gray-100 font-mono font-semibold text-slate-700">{row.replenishmentNumber}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{fmtDate(row.requestDate)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-600">{fmt(row.balanceBeforeReplenishment)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-slate-800">{fmt(row.amount)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-600">
                          {row.bankAccountId
                            ? `${row.bankAccountId.code ? row.bankAccountId.code + " — " : ""}${row.bankAccountId.name}`
                            : "—"}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{row.requestedBy?.name || "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-center">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[row.status] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-1">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => printReplenishmentSummary({ replenishment: row, disbursements, account: selectedAccount, company: currentCompany, user: currentUser })}
                              className="rounded px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
                              title="Print reimbursement form"
                            >
                              <FaPrint size={9} />
                            </button>
                            <button
                              onClick={() => setGlEntry({ data: row, sourceType: "petty_cash_replenishment" })}
                              className="rounded p-1 text-teal-600 hover:bg-teal-50 hover:text-teal-800"
                              title="View GL Entries"
                            >
                              <FaBook size={10} />
                            </button>
                            {row.status === "pending" && canApprove && (
                              <button
                                disabled={submitting}
                                onClick={() => handleApproveReplenishment(row._id)}
                                className="rounded px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                              >
                                Approve
                              </button>
                            )}
                            {row.status === "approved" && canApprove && (
                              <button
                                disabled={submitting}
                                onClick={() => handlePostReplenishment(row._id)}
                                className="rounded px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                Post
                              </button>
                            )}
                            {row.status === "pending" && canApprove && (
                              <button
                                disabled={submitting}
                                onClick={() => setShowRejectModal(row)}
                                className="rounded px-2 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Pagination ──────────────────────────────────────────────── */}
            {activeTab === "disbursements" && filteredDisbursements.length > 0 && (
              <PaginationBar
                page={disbPage}
                pages={disbPages}
                total={disbTotal}
                pageSize={pageSize}
                onPageChange={setDisbPage}
                onPageSizeChange={(n) => { setPageSize(n); setDisbPage(1); setRepPage(1); }}
                loading={loading}
                label="disbursements"
              />
            )}
            {activeTab === "replenishments" && repTotal > 0 && (
              <PaginationBar
                page={repPage}
                pages={repPages}
                total={repTotal}
                pageSize={pageSize}
                onPageChange={setRepPage}
                onPageSizeChange={(n) => { setPageSize(n); setDisbPage(1); setRepPage(1); }}
                loading={loading}
                label="replenishments"
              />
            )}
          </div>
        </div>
      </div>

      {/* ═══ Modals ═══════════════════════════════════════════════════════════ */}

      {/* New Account */}
      <PettyCashModal open={showNewAccount} title="New Petty Cash Account" onClose={() => closeAccountModal()}>
        <form onSubmit={handleCreateAccount} className="space-y-3">
          <div>
            <label className={labelClass}>Account Name <span className="text-red-500">*</span></label>
            <input className={inputClass} value={accountForm.name} onChange={(e) => setAccountForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Head Office Petty Cash" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Custodian Name</label>
              <input className={inputClass} value={accountForm.custodianName} onChange={(e) => setAccountForm((p) => ({ ...p, custodianName: e.target.value }))} placeholder="Person responsible" />
            </div>
            <div>
              <label className={labelClass}>Voucher Prefix</label>
              <input className={inputClass} value={accountForm.voucherPrefix} onChange={(e) => setAccountForm((p) => ({ ...p, voucherPrefix: e.target.value.toUpperCase().slice(0, 10) }))} placeholder="PCV" maxLength={10} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Float Amount (KES) <span className="text-red-500">*</span></label>
            <input type="number" min="0" step="1" className={inputClass} value={accountForm.floatAmount} onChange={(e) => setAccountForm((p) => ({ ...p, floatAmount: e.target.value }))} placeholder="e.g. 10000" />
          </div>
          <div>
            <label className={labelClass}>Petty Cash Asset Account (GL)</label>
            <AppSelect
              value={accountForm.glAccountId}
              onChange={(v) => setAccountForm((p) => ({ ...p, glAccountId: v ?? "" }))}
              options={assetAccounts.map((a) => ({ value: String(a._id), label: `${a.code ? a.code + " — " : ""}${a.name}` }))}
              placeholder="— Select account —"
              searchable
              clearable
              size="md"
              className="w-full"
            />
          </div>
          <div>
            <label className={labelClass}>Notes</label>
            <textarea className={inputClass} rows={2} value={accountForm.notes} onChange={(e) => setAccountForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => closeAccountModal()} className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className={`rounded-lg px-5 py-1.5 text-xs font-semibold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:opacity-50`}>
              {submitting ? "Saving…" : "Create Account"}
            </button>
          </div>
        </form>
      </PettyCashModal>

      {/* New Disbursement */}
      <PettyCashModal open={showNewDisbursement} title="Record Disbursement" onClose={() => closeDisbModal()}>
        <form onSubmit={handleCreateDisbursement} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Date <span className="text-red-500">*</span></label>
              <input type="date" className={inputClass} value={disbForm.date} onChange={(e) => setDisbForm((p) => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Amount (KES) <span className="text-red-500">*</span></label>
              <input type="number" min="0.01" step="0.01" className={inputClass} value={disbForm.amount} onChange={(e) => setDisbForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Description <span className="text-red-500">*</span></label>
            <input className={inputClass} value={disbForm.description} onChange={(e) => setDisbForm((p) => ({ ...p, description: e.target.value }))} placeholder="What was this expense for?" />
          </div>
          <div>
            <label className={labelClass}>Category <span className="text-red-500">*</span></label>
            <AppSelect
              value={disbForm.category}
              onChange={(v) => setDisbForm((p) => ({ ...p, category: v ?? "maintenance" }))}
              options={Object.entries(CATEGORY_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              searchable
              size="md"
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Property (optional)</label>
              <AppSelect
                value={disbForm.propertyId}
                onChange={(v) => setDisbForm((p) => ({ ...p, propertyId: v ?? "" }))}
                options={properties.map((p) => ({ value: String(p._id), label: p.propertyName }))}
                placeholder="— None —"
                searchable
                clearable
                size="md"
                className="w-full"
              />
            </div>
            <div>
              <label className={labelClass}>Expense Account (GL)</label>
              <AppSelect
                value={disbForm.expenseAccountId}
                onChange={(v) => setDisbForm((p) => ({ ...p, expenseAccountId: v ?? "" }))}
                options={expenseAccounts.map((a) => ({ value: String(a._id), label: `${a.code ? a.code + " — " : ""}${a.name}` }))}
                placeholder="— Auto / None —"
                searchable
                clearable
                size="md"
                className="w-full"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <input type="checkbox" id="rcptAttached" checked={disbForm.receiptAttached} onChange={(e) => setDisbForm((p) => ({ ...p, receiptAttached: e.target.checked }))} className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600" />
            <label htmlFor="rcptAttached" className="text-xs font-semibold text-slate-700">Receipt attached</label>
          </div>
          {!disbForm.receiptAttached && (
            <div>
              <label className={labelClass}>Reason (no receipt)</label>
              <input className={inputClass} value={disbForm.receiptNote} onChange={(e) => setDisbForm((p) => ({ ...p, receiptNote: e.target.value }))} placeholder="e.g. Receipt lost, purchase below KES 200" />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => closeDisbModal()} className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className={`rounded-lg px-5 py-1.5 text-xs font-semibold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:opacity-50`}>
              {submitting ? "Saving…" : "Record Disbursement"}
            </button>
          </div>
        </form>
      </PettyCashModal>

      {/* Replenishment Request */}
      <PettyCashModal open={showReplenishment} title="Request Replenishment" onClose={() => closeRepModal()}>
        <form onSubmit={handleRequestReplenishment} className="space-y-3">
          {selectedAccount && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs">
              <p className="font-semibold text-amber-900">Current balance: KES {fmt(selectedAccount.currentBalance)}</p>
              <p className="text-amber-700">Float target: KES {fmt(selectedAccount.floatAmount)}</p>
              {suggestedAmount > 0 && <p className="mt-1 font-semibold text-amber-800">Suggested top-up: KES {fmt(suggestedAmount)}</p>}
            </div>
          )}
          <div>
            <label className={labelClass}>Amount to Top Up (KES) <span className="text-red-500">*</span></label>
            <input type="number" min="0.01" step="0.01" className={inputClass} value={repForm.amount} onChange={(e) => setRepForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <label className={labelClass}>Draw From (Bank Account)</label>
            <AppSelect
              value={repForm.bankAccountId}
              onChange={(v) => setRepForm((p) => ({ ...p, bankAccountId: v ?? "" }))}
              options={bankAccounts.map((a) => ({ value: String(a._id), label: `${a.code ? a.code + " — " : ""}${a.name}` }))}
              placeholder="— Select bank account —"
              searchable
              clearable
              size="md"
              className="w-full"
            />
          </div>
          <div>
            <label className={labelClass}>Notes</label>
            <textarea className={inputClass} rows={2} value={repForm.notes} onChange={(e) => setRepForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes for approver" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => closeRepModal()} className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className="rounded-lg bg-amber-600 px-5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 shadow-sm">
              {submitting ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </form>
      </PettyCashModal>

      {/* Void Disbursement */}
      <PettyCashModal open={!!showVoidModal} title="Void Disbursement" onClose={() => { setShowVoidModal(null); setVoidReason(""); }}>
        {showVoidModal && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs">
              <p className="font-semibold text-red-900">{showVoidModal.voucherNumber} — KES {fmt(showVoidModal.amount)}</p>
              <p className="mt-0.5 text-red-700">{showVoidModal.description}</p>
              <p className="mt-2 text-red-600">This reverses the ledger entry and restores the balance. Cannot be undone.</p>
            </div>
            <div>
              <label className={labelClass}>Void Reason</label>
              <input className={inputClass} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason for voiding" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowVoidModal(null); setVoidReason(""); }} className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleVoid} disabled={submitting} className="rounded-lg bg-red-600 px-5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 shadow-sm">
                {submitting ? "Voiding…" : "Void"}
              </button>
            </div>
          </div>
        )}
      </PettyCashModal>

      {/* Reject Replenishment */}
      <PettyCashModal open={!!showRejectModal} title="Reject Replenishment" onClose={() => { setShowRejectModal(null); setRejectReason(""); }}>
        {showRejectModal && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs">
              <p className="font-semibold text-red-900">{showRejectModal.replenishmentNumber} — KES {fmt(showRejectModal.amount)}</p>
            </div>
            <div>
              <label className={labelClass}>Rejection Reason</label>
              <input className={inputClass} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this being rejected?" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowRejectModal(null); setRejectReason(""); }} className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleReject} disabled={submitting} className="rounded-lg bg-red-600 px-5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 shadow-sm">
                {submitting ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        )}
      </PettyCashModal>

      <JournalEntriesDrawer
        open={!!glEntry}
        onClose={() => setGlEntry(null)}
        title={glEntry?.sourceType === "petty_cash_replenishment" ? "Petty Cash Replenishment" : "Petty Cash Disbursement"}
        transactionRef={glEntry?.data?.voucherNumber || glEntry?.data?.replenishmentNumber || glEntry?.data?._id}
        date={glEntry ? new Date(glEntry.data.date || glEntry.data.requestDate || glEntry.data.createdAt).toLocaleDateString("en-GB") : ""}
        amount={glEntry?.data?.amount}
        status={glEntry?.data?.status}
        statusColors={glEntry?.data?.status === "active" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-700 border-slate-200"}
        contextFields={glEntry ? [
          { label: "Category", value: glEntry.data.category },
          { label: "Description", value: glEntry.data.description || glEntry.data.narration },
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
