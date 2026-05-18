import { LISTING_UI } from "../../utils/listingPageUtils";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaBoxOpen,
  FaCheck,
  FaMoneyBillWave,
  FaPrint,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaTimes,
  FaWallet,
} from "react-icons/fa";
import { printPettyCashVoucher, printReplenishmentSummary } from "../../utils/printPettyCash";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getChartOfAccounts } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyPermission } from "../../utils/permissions";
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

const PAGE_SIZE = 25;

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

const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
};

const inputCls =
  "w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] focus:border-[#0B3B2E]";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1";

// ─── Modal ────────────────────────────────────────────────────────────────────
const Modal = ({ open, title, onClose, children, wide }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl bg-white shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <FaTimes size={12} />
          </button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
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
  const properties = useSelector((s) => s.property?.properties || []);

  const [activeTab, setActiveTab] = useState("disbursements");
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [disbursements, setDisbursements] = useState([]);
  const [replenishments, setReplenishments] = useState([]);
  const [coas, setCoas] = useState([]);
  const [loading, setLoading] = useState(false);

  // draft filters (apply on Search)
  const [draftSearch, setDraftSearch] = useState("");
  const [draftCategory, setDraftCategory] = useState("any");
  const [draftStatus, setDraftStatus] = useState("any");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  // applied filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("any");
  const [filterStatus, setFilterStatus] = useState("any");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Modals
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showNewDisbursement, setShowNewDisbursement] = useState(false);
  const [showReplenishment, setShowReplenishment] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [disbPage, setDisbPage] = useState(1);
  const [repPage, setRepPage] = useState(1);

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
    dispatch(getProperties({ business: businessId }));
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
        getPettyCashDisbursements({ business: businessId, pettyCashAccountId: selectedAccountId }),
        getPettyCashReplenishments({ business: businessId, pettyCashAccountId: selectedAccountId }),
      ]);
      setDisbursements(d);
      setReplenishments(r);
    } catch { toast.error("Failed to load transactions"); }
    finally { setLoading(false); }
  }, [businessId, selectedAccountId]);

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
  const filteredDisbursements = useMemo(() => {
    let rows = disbursements;
    if (filterStatus === "any") rows = rows.filter((r) => r.status !== "void");
    if (filterCategory !== "any") rows = rows.filter((r) => r.category === filterCategory);
    if (filterStatus !== "any") rows = rows.filter((r) => r.status === filterStatus);
    if (filterFrom) rows = rows.filter((r) => new Date(r.date) >= new Date(filterFrom));
    if (filterTo) rows = rows.filter((r) => new Date(r.date) <= new Date(filterTo));
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.voucherNumber?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.property?.propertyName?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [disbursements, filterCategory, filterStatus, filterFrom, filterTo, search]);

  const filteredReplenishments = useMemo(() => {
    let rows = replenishments;
    if (filterStatus !== "any") rows = rows.filter((r) => r.status === filterStatus);
    if (filterFrom) rows = rows.filter((r) => new Date(r.requestDate) >= new Date(filterFrom));
    if (filterTo) rows = rows.filter((r) => new Date(r.requestDate) <= new Date(filterTo));
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.replenishmentNumber?.toLowerCase().includes(q));
    }
    return rows;
  }, [replenishments, filterStatus, filterFrom, filterTo, search]);

  // ── Paged slices
  const pagedDisbursements = useMemo(
    () => filteredDisbursements.slice((disbPage - 1) * PAGE_SIZE, disbPage * PAGE_SIZE),
    [filteredDisbursements, disbPage]
  );
  const pagedReplenishments = useMemo(
    () => filteredReplenishments.slice((repPage - 1) * PAGE_SIZE, repPage * PAGE_SIZE),
    [filteredReplenishments, repPage]
  );

  // ── Account helpers
  const bankAccounts = useMemo(
    () => coas.filter((a) => String(a.type).toLowerCase() === "asset" && /cash|bank|mpesa|mobile|wallet|till/i.test(`${a.name} ${a.subGroup || ""}`)),
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
              <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <span className="shrink-0 text-xs font-black text-slate-800">Petty Cash</span>
                {accounts.length > 0 && (
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  >
                    {accounts.map((a) => (
                      <option key={a._id} value={String(a._id)}>{a.name}</option>
                    ))}
                  </select>
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
                  <select value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                    <option value="any">Category</option>
                    {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
                <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                  <option value="any">Status</option>
                  {activeTab === "disbursements"
                    ? [["active", "Active"], ["void", "Void"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)
                    : [["pending", "Pending"], ["approved", "Approved"], ["posted", "Posted"], ["rejected", "Rejected"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)
                  }
                </select>
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
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#0B3B2E]">
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Voucher No.</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Date</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Description</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Category</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Property</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-white/90">Amount (KES)</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-white/90">Receipt</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-white/90">Status</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-white/90">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={9} className="py-16 text-center text-xs text-slate-400">Loading…</td></tr>
                    ) : filteredDisbursements.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-20 text-center">
                          <FaBoxOpen className="mx-auto mb-2 text-3xl text-slate-300" />
                          <p className="text-xs text-slate-400">No disbursements found</p>
                        </td>
                      </tr>
                    ) : pagedDisbursements.map((row) => (
                      <tr
                        key={row._id}
                        className={`cursor-default border-b border-slate-100 transition-colors hover:bg-slate-50 ${row.status === "void" ? "opacity-40" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-mono font-semibold text-slate-700">{row.voucherNumber}</td>
                        <td className="px-4 py-2.5 text-slate-600">{fmtDate(row.date)}</td>
                        <td className="max-w-[220px] px-4 py-2.5 text-slate-700">
                          <span className="line-clamp-2">{row.description}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_COLORS[row.category] || "bg-gray-100 text-gray-700"}`}>
                            {CATEGORY_LABELS[row.category] || row.category}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{row.property?.propertyName || "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-800">{fmt(row.amount)}</td>
                        <td className="px-4 py-2.5 text-center">
                          {row.receiptAttached
                            ? <FaCheck className="mx-auto text-emerald-600" size={10} />
                            : <span className="text-[10px] text-slate-400">{row.receiptNote ? "Noted" : "—"}</span>
                          }
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[row.status] || "bg-gray-100 text-gray-600"}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => printPettyCashVoucher({ disbursement: row, account: selectedAccount, company: currentCompany, user: currentUser })}
                              className="rounded px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
                              title="Print voucher"
                            >
                              <FaPrint size={9} />
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
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#0B3B2E]">
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Ref No.</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Request Date</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-white/90">Balance Before</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-white/90">Amount (KES)</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Bank Account</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/90">Requested By</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-white/90">Status</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-white/90">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={8} className="py-16 text-center text-xs text-slate-400">Loading…</td></tr>
                    ) : filteredReplenishments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-20 text-center">
                          <FaBoxOpen className="mx-auto mb-2 text-3xl text-slate-300" />
                          <p className="text-xs text-slate-400">No replenishments yet</p>
                        </td>
                      </tr>
                    ) : pagedReplenishments.map((row) => (
                      <tr key={row._id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono font-semibold text-slate-700">{row.replenishmentNumber}</td>
                        <td className="px-4 py-2.5 text-slate-600">{fmtDate(row.requestDate)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-600">{fmt(row.balanceBeforeReplenishment)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-800">{fmt(row.amount)}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {row.bankAccountId
                            ? `${row.bankAccountId.code ? row.bankAccountId.code + " — " : ""}${row.bankAccountId.name}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{row.requestedBy?.name || "—"}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[row.status] || "bg-gray-100 text-gray-600"}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => printReplenishmentSummary({ replenishment: row, disbursements, account: selectedAccount, company: currentCompany, user: currentUser })}
                              className="rounded px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
                              title="Print reimbursement form"
                            >
                              <FaPrint size={9} />
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
              <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
                <div className="font-semibold">
                  Showing{" "}
                  <span className="font-bold text-slate-900">{filteredDisbursements.length === 0 ? 0 : (disbPage - 1) * PAGE_SIZE + 1}</span>
                  {" "}to{" "}
                  <span className="font-bold text-slate-900">{Math.min(disbPage * PAGE_SIZE, filteredDisbursements.length)}</span>
                  {" "}of{" "}
                  <span className="font-bold text-slate-900">{filteredDisbursements.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setDisbPage((p) => Math.max(1, p - 1))} disabled={disbPage === 1} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                  <span className="font-semibold text-slate-700">Page {disbPage} of {Math.max(1, Math.ceil(filteredDisbursements.length / PAGE_SIZE))}</span>
                  <button type="button" onClick={() => setDisbPage((p) => Math.min(Math.ceil(filteredDisbursements.length / PAGE_SIZE), p + 1))} disabled={disbPage >= Math.ceil(filteredDisbursements.length / PAGE_SIZE)} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
            {activeTab === "replenishments" && filteredReplenishments.length > 0 && (
              <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
                <div className="font-semibold">
                  Showing{" "}
                  <span className="font-bold text-slate-900">{filteredReplenishments.length === 0 ? 0 : (repPage - 1) * PAGE_SIZE + 1}</span>
                  {" "}to{" "}
                  <span className="font-bold text-slate-900">{Math.min(repPage * PAGE_SIZE, filteredReplenishments.length)}</span>
                  {" "}of{" "}
                  <span className="font-bold text-slate-900">{filteredReplenishments.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setRepPage((p) => Math.max(1, p - 1))} disabled={repPage === 1} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                  <span className="font-semibold text-slate-700">Page {repPage} of {Math.max(1, Math.ceil(filteredReplenishments.length / PAGE_SIZE))}</span>
                  <button type="button" onClick={() => setRepPage((p) => Math.min(Math.ceil(filteredReplenishments.length / PAGE_SIZE), p + 1))} disabled={repPage >= Math.ceil(filteredReplenishments.length / PAGE_SIZE)} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Modals ═══════════════════════════════════════════════════════════ */}

      {/* New Account */}
      <Modal open={showNewAccount} title="New Petty Cash Account" onClose={() => closeAccountModal()}>
        <form onSubmit={handleCreateAccount} className="space-y-3">
          <div>
            <label className={labelCls}>Account Name <span className="text-red-500">*</span></label>
            <input className={inputCls} value={accountForm.name} onChange={(e) => setAccountForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Head Office Petty Cash" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Custodian Name</label>
              <input className={inputCls} value={accountForm.custodianName} onChange={(e) => setAccountForm((p) => ({ ...p, custodianName: e.target.value }))} placeholder="Person responsible" />
            </div>
            <div>
              <label className={labelCls}>Voucher Prefix</label>
              <input className={inputCls} value={accountForm.voucherPrefix} onChange={(e) => setAccountForm((p) => ({ ...p, voucherPrefix: e.target.value.toUpperCase().slice(0, 10) }))} placeholder="PCV" maxLength={10} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Float Amount (KES) <span className="text-red-500">*</span></label>
            <input type="number" min="0" step="1" className={inputCls} value={accountForm.floatAmount} onChange={(e) => setAccountForm((p) => ({ ...p, floatAmount: e.target.value }))} placeholder="e.g. 10000" />
          </div>
          <div>
            <label className={labelCls}>Petty Cash Asset Account (GL)</label>
            <select className={inputCls} value={accountForm.glAccountId} onChange={(e) => setAccountForm((p) => ({ ...p, glAccountId: e.target.value }))}>
              <option value="">— Select account —</option>
              {assetAccounts.map((a) => <option key={a._id} value={String(a._id)}>{a.code ? `${a.code} — ` : ""}{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea className={inputCls} rows={2} value={accountForm.notes} onChange={(e) => setAccountForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => closeAccountModal()} className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className={`rounded-lg px-5 py-1.5 text-xs font-semibold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:opacity-50`}>
              {submitting ? "Saving…" : "Create Account"}
            </button>
          </div>
        </form>
      </Modal>

      {/* New Disbursement */}
      <Modal open={showNewDisbursement} title="Record Disbursement" onClose={() => closeDisbModal()}>
        <form onSubmit={handleCreateDisbursement} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date <span className="text-red-500">*</span></label>
              <input type="date" className={inputCls} value={disbForm.date} onChange={(e) => setDisbForm((p) => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Amount (KES) <span className="text-red-500">*</span></label>
              <input type="number" min="0.01" step="0.01" className={inputCls} value={disbForm.amount} onChange={(e) => setDisbForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Description <span className="text-red-500">*</span></label>
            <input className={inputCls} value={disbForm.description} onChange={(e) => setDisbForm((p) => ({ ...p, description: e.target.value }))} placeholder="What was this expense for?" />
          </div>
          <div>
            <label className={labelCls}>Category <span className="text-red-500">*</span></label>
            <select className={inputCls} value={disbForm.category} onChange={(e) => setDisbForm((p) => ({ ...p, category: e.target.value }))}>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Property (optional)</label>
              <select className={inputCls} value={disbForm.propertyId} onChange={(e) => setDisbForm((p) => ({ ...p, propertyId: e.target.value }))}>
                <option value="">— None —</option>
                {properties.map((p) => <option key={p._id} value={String(p._id)}>{p.propertyName}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Expense Account (GL)</label>
              <select className={inputCls} value={disbForm.expenseAccountId} onChange={(e) => setDisbForm((p) => ({ ...p, expenseAccountId: e.target.value }))}>
                <option value="">— Auto / None —</option>
                {expenseAccounts.map((a) => <option key={a._id} value={String(a._id)}>{a.code ? `${a.code} — ` : ""}{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <input type="checkbox" id="rcptAttached" checked={disbForm.receiptAttached} onChange={(e) => setDisbForm((p) => ({ ...p, receiptAttached: e.target.checked }))} className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600" />
            <label htmlFor="rcptAttached" className="text-xs font-semibold text-slate-700">Receipt attached</label>
          </div>
          {!disbForm.receiptAttached && (
            <div>
              <label className={labelCls}>Reason (no receipt)</label>
              <input className={inputCls} value={disbForm.receiptNote} onChange={(e) => setDisbForm((p) => ({ ...p, receiptNote: e.target.value }))} placeholder="e.g. Receipt lost, purchase below KES 200" />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => closeDisbModal()} className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className={`rounded-lg px-5 py-1.5 text-xs font-semibold text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:opacity-50`}>
              {submitting ? "Saving…" : "Record Disbursement"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Replenishment Request */}
      <Modal open={showReplenishment} title="Request Replenishment" onClose={() => closeRepModal()}>
        <form onSubmit={handleRequestReplenishment} className="space-y-3">
          {selectedAccount && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs">
              <p className="font-semibold text-amber-900">Current balance: KES {fmt(selectedAccount.currentBalance)}</p>
              <p className="text-amber-700">Float target: KES {fmt(selectedAccount.floatAmount)}</p>
              {suggestedAmount > 0 && <p className="mt-1 font-semibold text-amber-800">Suggested top-up: KES {fmt(suggestedAmount)}</p>}
            </div>
          )}
          <div>
            <label className={labelCls}>Amount to Top Up (KES) <span className="text-red-500">*</span></label>
            <input type="number" min="0.01" step="0.01" className={inputCls} value={repForm.amount} onChange={(e) => setRepForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <label className={labelCls}>Draw From (Bank Account)</label>
            <select className={inputCls} value={repForm.bankAccountId} onChange={(e) => setRepForm((p) => ({ ...p, bankAccountId: e.target.value }))}>
              <option value="">— Select bank account —</option>
              {bankAccounts.map((a) => <option key={a._id} value={String(a._id)}>{a.code ? `${a.code} — ` : ""}{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea className={inputCls} rows={2} value={repForm.notes} onChange={(e) => setRepForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes for approver" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => closeRepModal()} className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className="rounded-lg bg-amber-600 px-5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 shadow-sm">
              {submitting ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Void Disbursement */}
      <Modal open={!!showVoidModal} title="Void Disbursement" onClose={() => { setShowVoidModal(null); setVoidReason(""); }}>
        {showVoidModal && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs">
              <p className="font-semibold text-red-900">{showVoidModal.voucherNumber} — KES {fmt(showVoidModal.amount)}</p>
              <p className="mt-0.5 text-red-700">{showVoidModal.description}</p>
              <p className="mt-2 text-red-600">This reverses the ledger entry and restores the balance. Cannot be undone.</p>
            </div>
            <div>
              <label className={labelCls}>Void Reason</label>
              <input className={inputCls} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason for voiding" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowVoidModal(null); setVoidReason(""); }} className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleVoid} disabled={submitting} className="rounded-lg bg-red-600 px-5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 shadow-sm">
                {submitting ? "Voiding…" : "Void"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reject Replenishment */}
      <Modal open={!!showRejectModal} title="Reject Replenishment" onClose={() => { setShowRejectModal(null); setRejectReason(""); }}>
        {showRejectModal && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs">
              <p className="font-semibold text-red-900">{showRejectModal.replenishmentNumber} — KES {fmt(showRejectModal.amount)}</p>
            </div>
            <div>
              <label className={labelCls}>Rejection Reason</label>
              <input className={inputCls} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this being rejected?" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowRejectModal(null); setRejectReason(""); }} className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleReject} disabled={submitting} className="rounded-lg bg-red-600 px-5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 shadow-sm">
                {submitting ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        )}
      </Modal>

    </DashboardLayout>
  );
};

export default PettyCash;
