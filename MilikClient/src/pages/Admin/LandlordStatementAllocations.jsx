import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { selectCurrentUser, selectCurrentCompany, selectAllProperties, selectAllTenants } from "../../redux/selectors";
import { adminRequests } from "../../utils/requestMethods";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaSearch, FaCalendarAlt, FaExchangeAlt, FaHistory, FaShieldAlt,
  FaTimes, FaCheck, FaInfoCircle, FaMoneyBillWave, FaFileInvoice,
  FaReceipt, FaFileAlt, FaChevronLeft, FaChevronRight, FaRedoAlt,
  FaUser, FaPlus, FaChevronDown, FaChevronUp,
} from "react-icons/fa";

const ITEMS_PER_PAGE = 50;

// Cache Intl instances — creating them on every render/call is expensive
const _numFmt  = new Intl.NumberFormat("en-KE");
const _dateFmt = new Intl.DateTimeFormat("en-KE", { day: "2-digit", month: "short", year: "numeric" });
const fmtKES  = (n) => _numFmt.format(Number(n || 0));
const fmtDate = (d) => d ? _dateFmt.format(new Date(d)) : "-";
const toInput  = (d) => d ? new Date(d).toISOString().slice(0, 10) : "";
const round2     = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmtPeriod  = (d) => { if (!d) return "—"; const dt = new Date(d); return `${dt.toLocaleString("en", { month: "short" })}/${dt.getFullYear()}`; };

const tName = (t) => t?.name || `${t?.firstName || ""} ${t?.lastName || ""}`.trim() || "Unknown";

const TABS = [
  { id: "all",           label: "All",          icon: null },
  { id: "payment",       label: "Payments",      icon: FaReceipt },
  { id: "invoice",       label: "Invoices",      icon: FaFileInvoice },
  { id: "credit_note",   label: "Credit Notes",  icon: FaFileAlt },
  { id: "debit_note",    label: "Debit Notes",   icon: FaFileAlt },
  { id: "meter_reading", label: "Meter Rdgs",    icon: FaMoneyBillWave },
  { id: "history",       label: "History",       icon: FaHistory },
];

const TYPE_COLOR = {
  payment:       "bg-emerald-100 text-emerald-700",
  invoice:       "bg-blue-100 text-blue-700",
  credit_note:   "bg-purple-100 text-purple-700",
  debit_note:    "bg-orange-100 text-orange-700",
  meter_reading: "bg-slate-100 text-slate-600",
};

const STATUS_CLS = {
  confirmed:     "bg-emerald-50 text-emerald-700 border border-emerald-200",
  pending:       "bg-amber-50 text-amber-700 border border-amber-200",
  cancelled:     "bg-red-50 text-red-600 border border-red-200",
  reversed:      "bg-red-50 text-red-600 border border-red-200",
  paid:          "bg-emerald-50 text-emerald-700 border border-emerald-200",
  partially_paid:"bg-blue-50 text-blue-700 border border-blue-200",
  billed:        "bg-emerald-50 text-emerald-700 border border-emerald-200",
  draft:         "bg-slate-50 text-slate-600 border border-slate-200",
  void:          "bg-red-50 text-red-500 border border-red-100",
};

const CAT_LABEL = {
  RENT_CHARGE: "Rent", DEPOSIT_CHARGE: "Deposit", UTILITY_CHARGE: "Utility",
  LATE_PENALTY_CHARGE: "Late Penalty", OTHER_CHARGE: "Other",
  DEBIT_NOTE: "Debit Note", CREDIT_NOTE: "Credit Note",
  METER_READING: "Meter Rdg",
};

const CAT_BADGE = {
  RENT_CHARGE:         "bg-blue-100 text-blue-700",
  DEPOSIT_CHARGE:      "bg-amber-100 text-amber-700",
  UTILITY_CHARGE:      "bg-purple-100 text-purple-700",
  LATE_PENALTY_CHARGE: "bg-rose-100 text-rose-700",
  DEBIT_NOTE:          "bg-orange-100 text-orange-700",
  CREDIT_NOTE:         "bg-teal-100 text-teal-700",
  OTHER_CHARGE:        "bg-slate-100 text-slate-600",
  METER_READING:       "bg-cyan-100 text-cyan-700",
};

const PAYMENT_TYPE_LABEL = {
  CASH: "Cash", MPESA: "M-Pesa", BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque", CARD: "Card", OTHER: "Other",
};

// ─── SIDE PANEL ────────────────────────────────────────────────────────────────
const SidePanel = React.memo(function SidePanel({ open, onClose, title, subtitle, wide = false, children }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className={`fixed right-0 top-0 z-50 flex h-full flex-col bg-white shadow-2xl border-l border-slate-200 w-full ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B3B2E] px-5 py-3.5">
          <div>
            <p className="text-sm font-black text-white">{title}</p>
            {subtitle && <p className="mt-0.5 text-xs text-white/70">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes size={13} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
});

export default function LandlordStatementAllocations() {
  const currentUser    = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const properties     = useSelector(selectAllProperties);
  const allTenants     = useSelector(selectAllTenants);
  const isMilikAdmin   = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);
  const bizId          = currentCompany?._id;

  // ── Search state ─────────────────────────────────────────────────────────────
  const [activeTab,  setActiveTab]  = useState("all");
  const [refSearch,  setRefSearch]  = useState("");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [property,   setProperty]   = useState("");
  const [results,       setResults]       = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [searched,      setSearched]      = useState(false);
  const [currentPage,   setCurrentPage]   = useState(1);
  const [showReversed,  setShowReversed]  = useState(false);
  const [collapsedPayments, setCollapsedPayments] = useState(new Set());

  // ── Tenant combobox ───────────────────────────────────────────────────────────
  const [tenantQuery,    setTenantQuery]    = useState("");
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [tenantDropOpen, setTenantDropOpen] = useState(false);
  const [dropPos,        setDropPos]        = useState({ top: 0, left: 0 });
  const tenantRef   = useRef(null); // button wrapper — for position calc
  const dropdownRef = useRef(null); // panel — for click-outside (panel is fixed, outside tenantRef)

  // ── History state ─────────────────────────────────────────────────────────────
  const [history,     setHistory]     = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histPage,    setHistPage]    = useState(1);
  const [histTotal,   setHistTotal]   = useState(0);

  // ── Date-shift / narration panel ──────────────────────────────────────────────
  const [datePanel,    setDatePanel]    = useState(null);
  const [newBookDate,  setNewBookDate]  = useState("");
  const [newNarration, setNewNarration] = useState("");
  const [dateReason,   setDateReason]   = useState("");
  const [dateSaving,   setDateSaving]   = useState(false);

  // ── Realloc panel ─────────────────────────────────────────────────────────────
  const [reallocPanel,   setReallocPanel]   = useState(null);
  const [availInvoices,  setAvailInvoices]  = useState([]);
  const [invLoading,     setInvLoading]     = useState(false);
  const [invFilter,      setInvFilter]      = useState("");
  const [reallocRows,    setReallocRows]    = useState([]);
  const [reallocReason,  setReallocReason]  = useState("");
  const [reallocSaving,  setReallocSaving]  = useState(false);

  // ── Tenant combobox memos ─────────────────────────────────────────────────────
  const propertyFilteredTenants = useMemo(() => {
    if (!property) return allTenants;
    const pid = String(property);
    return allTenants.filter((t) => {
      const p = t.unit?.property?._id
        ? String(t.unit.property._id)
        : t.unit?.property ? String(t.unit.property)
        : t.property?._id ? String(t.property._id)
        : t.property ? String(t.property) : null;
      return p === pid;
    });
  }, [allTenants, property]);

  const tenantDropList = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase();
    if (!q) return propertyFilteredTenants.slice(0, 60);
    return propertyFilteredTenants.filter((t) => {
      const name = tName(t).toLowerCase();
      const code = (t.tenantCode || "").toLowerCase();
      const unit = (t.unit?.unitNumber || "").toLowerCase();
      return name.includes(q) || code.includes(q) || unit.includes(q);
    }).slice(0, 60);
  }, [propertyFilteredTenants, tenantQuery]);

  // Close tenant dropdown on outside click.
  // dropdownRef covers the fixed panel which is no longer a DOM child of tenantRef.
  useEffect(() => {
    if (!tenantDropOpen) return;
    const handler = (e) => {
      const inButton = tenantRef.current?.contains(e.target);
      const inPanel  = dropdownRef.current?.contains(e.target);
      if (!inButton && !inPanel) setTenantDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tenantDropOpen]);

  // Clear tenant selection when property changes and selected tenant no longer matches
  useEffect(() => {
    if (!selectedTenant || !property) return;
    const t = allTenants.find((x) => String(x._id) === String(selectedTenant._id));
    if (!t) return;
    const p = t.unit?.property?._id ? String(t.unit.property._id) : t.unit?.property ? String(t.unit.property) : null;
    if (p && p !== String(property)) { setSelectedTenant(null); setTenantQuery(""); }
  }, [property]); // eslint-disable-line

  const selectTenant = useCallback((t) => {
    setSelectedTenant({ _id: t._id, displayName: tName(t), tenantCode: t.tenantCode, unitNumber: t.unit?.unitNumber });
    setTenantQuery("");
    setTenantDropOpen(false);
  }, []);

  const clearTenant = useCallback(() => {
    setSelectedTenant(null); setTenantQuery(""); setTenantDropOpen(false);
  }, []);

  // ── Derived display data ──────────────────────────────────────────────────────
  // Apply permanent filters first (billed meter readings + reversed toggle),
  // then derive tab counts and per-tab display from the same filtered base.
  const filteredBase = useMemo(() => {
    let list = results;
    // Billed meter readings are kept — they're shown with bill=0 in ledgerRows
    // (the invoice row carries the amount; reading row is informational context)
    if (!showReversed) list = list.filter((r) => r.status !== "reversed");
    return list;
  }, [results, showReversed]);

  const typeCounts = useMemo(() => {
    const c = { all: filteredBase.length, payment: 0, invoice: 0, credit_note: 0, debit_note: 0, meter_reading: 0 };
    filteredBase.forEach((r) => { if (r.type in c) c[r.type]++; });
    return c;
  }, [filteredBase]);

  const displayResults = useMemo(() => {
    if (activeTab === "all" || activeTab === "history") return filteredBase;
    return filteredBase.filter((r) => r.type === activeTab);
  }, [filteredBase, activeTab]);

  // Expand payment transactions into per-allocation ledger rows (flat ledger view)
  const ledgerRows = useMemo(() => {
    const rows = [];
    for (const tx of displayResults) {
      if (tx.type === "payment") {
        const allocs = tx.allocations || [];
        if (allocs.length > 0) {
          allocs.forEach((a, ai) => rows.push({
            _rowKey: `${tx._id}-a${ai}`,
            _kind: "paid",
            _tx: tx,
            _isFirst: ai === 0,
            category: a.category,
            period: a.invoiceDate || tx.transactionDate,
            narration: a.description || CAT_LABEL[a.category] || "",
            invoiceNumber: a.invoiceNumber || null,
            txnNo: tx.refNumber,
            refAlt: tx.refAlt,
            txDate: tx.transactionDate,
            bankingDate: tx.bookingDate || tx.transactionDate,
            bill: 0,
            paid: round2(Number(a.appliedAmount || 0)),
            status: tx.status,
            isUnapplied: !a.invoice,
          }));
        } else {
          rows.push({
            _rowKey: `${tx._id}-p`,
            _kind: "paid",
            _tx: tx,
            _isFirst: true,
            category: null,
            period: tx.transactionDate,
            narration: tx.description || "Unapplied receipt",
            invoiceNumber: null,
            txnNo: tx.refNumber,
            refAlt: tx.refAlt,
            txDate: tx.transactionDate,
            bankingDate: tx.bookingDate || tx.transactionDate,
            bill: 0,
            paid: round2(Number(tx.amount || 0)),
            status: tx.status,
            isUnapplied: true,
          });
        }
      } else {
        const isCreditNote = tx.type === "credit_note";
        const isMeterReading = tx.type === "meter_reading";
        const isBilledReading = isMeterReading && tx.status === "billed";
        rows.push({
          _rowKey: `${tx._id}-b`,
          _kind: isCreditNote ? "credit" : "bill",
          _tx: tx,
          _isFirst: true,
          category: isMeterReading ? "METER_READING" : tx.subType,
          period: tx.transactionDate,
          narration: isMeterReading
            ? (isBilledReading
                ? `Reading → ${tx.linkedInvoiceNumber || "Invoiced"}`
                : (tx.description || "Pending billing"))
            : (tx.description || ""),
          invoiceNumber: isMeterReading ? (tx.linkedInvoiceNumber || null) : tx.refNumber,
          txnNo: null,
          refAlt: null,
          txDate: tx.transactionDate,
          bankingDate: tx.bookingDate,
          // Billed readings show bill=0 — the invoice row already carries the amount.
          // Unbilled (draft) readings show the projected charge.
          bill: isCreditNote ? 0 : isBilledReading ? 0 : round2(Number(tx.amount || 0)),
          paid: isCreditNote ? round2(Number(tx.amount || 0)) : 0,
          status: tx.status,
          outstanding: tx.outstanding,
          taxAmount: tx.taxAmount || 0,
          taxRate: tx.taxRate || 0,
        });
      }
    }
    return rows;
  }, [displayResults]);

  const ledgerTotals = useMemo(() => {
    // Exclude reversed rows — their amounts are void and must not inflate totals
    const active = ledgerRows.filter((r) => r.status !== "reversed");
    return {
      bill: round2(active.reduce((s, r) => s + (r.bill || 0), 0)),
      paid: round2(active.reduce((s, r) => s + (r.paid || 0), 0)),
    };
  }, [ledgerRows]);

  // All pagination derived state in one memo
  const { totalPages, safePage, startIdx, endIdx, paginatedRows } = useMemo(() => {
    const tp = Math.max(1, Math.ceil(ledgerRows.length / ITEMS_PER_PAGE));
    const sp = Math.min(currentPage, tp);
    const si = ledgerRows.length === 0 ? 0 : (sp - 1) * ITEMS_PER_PAGE;
    const ei = si + ITEMS_PER_PAGE;
    return { totalPages: tp, safePage: sp, startIdx: si, endIdx: ei, paginatedRows: ledgerRows.slice(si, ei) };
  }, [ledgerRows, currentPage]);
  const histTotalPages = Math.max(1, Math.ceil(histTotal / 50));

  // Reset to page 1 on tab switch or new search result; safePage already caps for shrinking result sets
  useEffect(() => { setCurrentPage(1); }, [activeTab, results]);

  useEffect(() => {
    if (activeTab === "history" && history.length === 0 && !histLoading) loadHistory(1);
  }, [activeTab]); // eslint-disable-line

  // ── API calls ─────────────────────────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    setSearched(true);
    try {
      const { data } = await adminRequests.get("/admin/statement-allocations/search", {
        params: {
          search: refSearch, dateFrom, dateTo, property,
          tenantId: selectedTenant?._id || "",
          business: bizId, page: 1,
        },
      });
      setResults(data.data || []);
      setCollapsedPayments(new Set()); // expand all payment allocations on fresh search
      setActiveTab("all"); // always land on All tab after search
    } catch (e) {
      toast.error(e?.response?.data?.error || "Search failed");
    } finally {
      setLoading(false);
    }
  }, [bizId, refSearch, dateFrom, dateTo, property, selectedTenant]);

  const loadHistory = useCallback(async (pg = 1) => {
    if (!bizId) return;
    setHistLoading(true);
    try {
      const { data } = await adminRequests.get("/admin/statement-allocations/history", {
        params: { business: bizId, page: pg },
      });
      setHistory(data.data || []);
      setHistTotal(data.total || 0);
      setHistPage(pg);
    } catch { toast.error("Failed to load history"); }
    finally { setHistLoading(false); }
  }, [bizId]);

  // ── Date shift ─────────────────────────────────────────────────────────────────
  const openDatePanel = useCallback((tx) => {
    setDatePanel(tx);
    setNewBookDate(toInput(tx.bookingDate || tx.transactionDate));
    setNewNarration(tx.description || "");
    setDateReason("");
  }, []);

  const closeDatePanel = useCallback(() => {
    setDatePanel(null); setNewBookDate(""); setNewNarration(""); setDateReason("");
  }, []);

  const saveDateShift = useCallback(async () => {
    if (!dateReason.trim()) { toast.warning("Reason is required"); return; }
    const origDate = toInput(datePanel?.bookingDate || datePanel?.transactionDate);
    const origNarration = datePanel?.description || "";
    const dateChanged = newBookDate && newBookDate !== origDate;
    const narrationChanged = newNarration.trim() !== origNarration.trim();
    if (!dateChanged && !narrationChanged) { toast.warning("No changes detected"); return; }

    if (dateChanged) {
      const origSrc = datePanel?.bookingDate || datePanel?.transactionDate;
      if (origSrc) {
        const diffYears = Math.abs(new Date(newBookDate) - new Date(origSrc)) / (1000 * 60 * 60 * 24 * 365);
        if (diffYears > 3) toast.warning("Booking date is more than 3 years from the original. Please confirm this is correct.");
      }
    }
    setDateSaving(true);
    try {
      await adminRequests.patch("/admin/statement-allocations/booking-date", {
        type: datePanel.type, id: datePanel._id,
        bookingDate: dateChanged ? newBookDate : undefined,
        narration: narrationChanged ? newNarration.trim() : undefined,
        reason: dateReason.trim(), business: bizId,
      });
      const parts = [dateChanged && "booking date", narrationChanged && "narration"].filter(Boolean).join(" and ");
      toast.success(`Transaction ${parts} updated`);
      toast.warning("Regenerate the landlord statement for the affected period to see updated figures.", { autoClose: 8000 });
      closeDatePanel();
      runSearch();
    } catch (e) { toast.error(e?.response?.data?.error || "Failed"); }
    finally { setDateSaving(false); }
  }, [datePanel, newBookDate, newNarration, dateReason, bizId, closeDatePanel, runSearch]);

  const periodLabel = useMemo(() => {
    if (!newBookDate) return null;
    return new Date(newBookDate).toLocaleDateString("en-KE", { month: "long", year: "numeric" });
  }, [newBookDate]);

  const origPeriod = useMemo(() => {
    if (!datePanel) return null;
    const src = datePanel.bookingDate || datePanel.transactionDate;
    return src ? new Date(src).toLocaleDateString("en-KE", { month: "long", year: "numeric" }) : null;
  }, [datePanel]);

  // ── Reallocation ──────────────────────────────────────────────────────────────
  const openReallocPanel = useCallback(async (tx) => {
    setReallocPanel(tx);
    setReallocReason("");
    setInvFilter("");
    setReallocRows((tx.allocations || []).map((a) => ({
      invoiceId: a.invoice ? String(a.invoice) : null,
      invoiceNumber: a.invoiceNumber || "",
      category: a.category || "",
      description: a.description || "",
      outstanding: a.afterOutstanding ?? 0,
      invoiceDate: a.invoiceDate || null,
      amount: a.appliedAmount || 0,
    })));
    if (tx.tenantId) {
      setInvLoading(true);
      try {
        const { data } = await adminRequests.get("/admin/statement-allocations/invoices", {
          params: { tenantId: tx.tenantId, paymentId: tx._id, business: bizId },
        });
        setAvailInvoices(data.data || []);
      } catch { setAvailInvoices([]); }
      finally { setInvLoading(false); }
    }
  }, [bizId]);

  const closeReallocPanel = useCallback(() => {
    setReallocPanel(null); setReallocRows([]); setAvailInvoices([]); setReallocReason(""); setInvFilter("");
  }, []);

  const reallocTotal  = useMemo(() => round2(reallocRows.reduce((s, r) => s + Number(r.amount || 0), 0)), [reallocRows]);
  const reallocAmt    = useMemo(() => round2(reallocPanel?.amount || 0), [reallocPanel]);
  const reallocDiff   = useMemo(() => round2(reallocTotal - reallocAmt), [reallocTotal, reallocAmt]);
  const reallocValid  = Math.abs(reallocDiff) <= 0.01;
  const remaining     = useMemo(() => round2(reallocAmt - reallocTotal), [reallocAmt, reallocTotal]);

  const updateRow = useCallback((idx, val) => {
    setReallocRows((rows) => rows.map((r, i) => i === idx ? { ...r, amount: val } : r));
  }, []);

  const removeRow = useCallback((idx) => setReallocRows((rows) => rows.filter((_, i) => i !== idx)), []);

  const addInvoice = useCallback((inv) => {
    setReallocRows((rows) => {
      if (rows.some((r) => r.invoiceId === String(inv._id))) return rows;
      const rowTotal = round2(rows.reduce((s, r) => s + Number(r.amount || 0), 0));
      const rem = round2(reallocAmt - rowTotal);
      // For currently-allocated (paid) invoices, the full invoice amount can be re-applied
      const maxApplicable = inv._currentlyAllocated ? Number(inv.amount || 0) : Number(inv.outstanding || 0);
      const smartAmt = round2(Math.min(maxApplicable, Math.max(0, rem)));
      return [...rows, {
        invoiceId: String(inv._id),
        invoiceNumber: inv.invoiceNumber,
        category: inv.category,
        description: inv.description || "",
        outstanding: inv._currentlyAllocated ? inv.amount : inv.outstanding,
        invoiceDate: inv.invoiceDate,
        amount: smartAmt,
      }];
    });
  }, [reallocAmt]);

  const filteredAvailInvoices = useMemo(() => {
    if (!invFilter.trim()) return availInvoices;
    const q = invFilter.toLowerCase();
    return availInvoices.filter((inv) => {
      const num  = (inv.invoiceNumber || "").toLowerCase();
      const cat  = (CAT_LABEL[inv.category] || inv.category || "").toLowerCase();
      const desc = (inv.description || "").toLowerCase();
      return num.includes(q) || cat.includes(q) || desc.includes(q);
    });
  }, [availInvoices, invFilter]);

  const saveRealloc = useCallback(async () => {
    if (!reallocReason.trim()) { toast.warning("Reason required"); return; }
    if (!reallocValid) { toast.warning(`Total must equal Ksh ${fmtKES(reallocAmt)}`); return; }
    setReallocSaving(true);
    try {
      const res = await adminRequests.patch("/admin/statement-allocations/reallocate", {
        paymentId: reallocPanel._id, business: bizId, reason: reallocReason.trim(),
        allocations: reallocRows.map((r) => ({ invoiceId: r.invoiceId || null, category: r.category, amount: Number(r.amount || 0) })),
      });
      toast.success("Payment reallocated successfully");
      // Always warn: landlord statement must be regenerated to reflect the new allocation
      toast.warning(
        res?.data?.statementWarning || "Regenerate the landlord statement for the affected period to see updated figures.",
        { autoClose: 8000 }
      );
      closeReallocPanel();
      runSearch();
    } catch (e) { toast.error(e?.response?.data?.error || "Reallocation failed"); }
    finally { setReallocSaving(false); }
  }, [reallocPanel, reallocReason, reallocValid, reallocRows, reallocAmt, bizId, closeReallocPanel, runSearch]);

  if (!isMilikAdmin) {
    return (
      <DashboardLayout>
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <FaShieldAlt className="mx-auto mb-3 text-slate-300" size={40} />
            <p className="text-sm font-bold text-slate-500">Milik Admin access required</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <>
      <DashboardLayout lockContentScroll>
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
          <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col overflow-hidden gap-2">

            {/* ── Sticky header — single scrollable line ── */}
            <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">

                {/* Tabs */}
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const count = tab.id !== "history" ? typeCounts[tab.id] : histTotal;
                  const active = activeTab === tab.id;
                  return (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                      className={`h-7 shrink-0 inline-flex items-center gap-1 rounded px-2 text-[11px] font-bold transition
                        ${active ? "bg-[#0B3B2E] text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}>
                      {Icon && <Icon size={9} />}
                      {tab.label}
                      {searched && tab.id !== "history" && (
                        <span className={`ml-0.5 rounded-full px-1.5 py-px text-[9px] font-black ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}

                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />

                {/* Property */}
                <select value={property} onChange={(e) => setProperty(e.target.value)}
                  className="h-7 shrink-0 max-w-[140px] rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 appearance-none outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
                  <option value="">All properties</option>
                  {properties.map((p) => <option key={p._id} value={p._id}>{p.propertyName}</option>)}
                </select>

                {/* Tenant searchable dropdown */}
                <div className="shrink-0" ref={tenantRef}>
                  {/* Trigger button — captures screen position for the fixed panel */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!tenantDropOpen) {
                        const rect = tenantRef.current?.getBoundingClientRect();
                        if (rect) setDropPos({ top: rect.bottom + 4, left: rect.left });
                      }
                      setTenantDropOpen((o) => !o);
                    }}
                    className={`h-7 inline-flex items-center gap-1.5 rounded border px-2 text-xs transition
                      ${selectedTenant
                        ? "border-[#0B3B2E]/40 bg-[#0B3B2E]/5 text-[#0B3B2E]"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                    <FaUser size={8} className={selectedTenant ? "text-[#0B3B2E]" : "text-slate-400"} />
                    {selectedTenant ? (
                      <span className="max-w-[130px] truncate font-bold">{selectedTenant.displayName}
                        {selectedTenant.tenantCode && <span className="ml-1 font-normal opacity-60">({selectedTenant.tenantCode})</span>}
                      </span>
                    ) : (
                      <span>All tenants</span>
                    )}
                    <svg className="ml-0.5 shrink-0 text-slate-400" width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                      <path d="M5 7L1 3h8z"/>
                    </svg>
                  </button>

                  {/* Dropdown panel — fixed so the overflow-x-auto header never clips or scrolls to it */}
                  {tenantDropOpen && (
                    <div ref={dropdownRef}
                      className="fixed z-[999] w-72 rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden"
                      style={{ top: dropPos.top, left: dropPos.left }}>
                      {/* Search input inside dropdown */}
                      <div className="border-b border-slate-100 p-2">
                        <div className="relative">
                          <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                          <input
                            type="text"
                            placeholder="Search by name, code or unit…"
                            value={tenantQuery}
                            onChange={(e) => setTenantQuery(e.target.value)}
                            autoFocus
                            className="h-7 w-full rounded border border-slate-200 bg-slate-50 pl-6 pr-2 text-xs text-slate-700 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          />
                        </div>
                      </div>
                      {/* All tenants option */}
                      <div className="max-h-52 overflow-y-auto">
                        <button onMouseDown={clearTenant}
                          className={`flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-50 ${!selectedTenant ? "bg-[#0B3B2E]/5 font-bold text-[#0B3B2E]" : "text-slate-500"}`}>
                          <FaUser size={8} className="opacity-40 shrink-0" />
                          All tenants
                        </button>
                        {tenantDropList.length === 0 && tenantQuery && (
                          <p className="px-3 py-3 text-center text-xs text-slate-400">No tenants match "{tenantQuery}"</p>
                        )}
                        {tenantDropList.length === 0 && !tenantQuery && (
                          <p className="px-3 py-3 text-center text-xs text-slate-400">No tenants available{property ? " for this property" : ""}</p>
                        )}
                        {tenantDropList.map((t) => {
                          const isSelected = selectedTenant != null && String(selectedTenant._id) === String(t._id);
                          return (
                            <button key={t._id} onMouseDown={() => selectTenant(t)}
                              className={`flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2 text-left last:border-0 hover:bg-slate-50 ${isSelected ? "bg-[#0B3B2E]/5" : ""}`}>
                              <FaUser className={`mt-0.5 shrink-0 ${isSelected ? "text-[#0B3B2E]" : "text-slate-300"}`} size={9} />
                              <div className="min-w-0">
                                <p className={`truncate text-xs font-bold ${isSelected ? "text-[#0B3B2E]" : "text-slate-800"}`}>{tName(t)}</p>
                                <p className="text-[10px] text-slate-500">
                                  {t.tenantCode && <span className="mr-2 font-mono">{t.tenantCode}</span>}
                                  {t.unit?.unitNumber && <span>Unit {t.unit.unitNumber}</span>}
                                </p>
                              </div>
                              {isSelected && <FaCheck className="ml-auto mt-0.5 shrink-0 text-[#0B3B2E]" size={9} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />

                {/* Ref search */}
                <div className="relative shrink-0">
                  <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                  <input type="text" placeholder="Ref / receipt…" value={refSearch}
                    onChange={(e) => setRefSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    className="h-7 w-32 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs text-slate-700 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </div>

                {/* Date range */}
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                <span className="shrink-0 text-[10px] text-slate-400">–</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />

                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />

                <button onClick={runSearch} disabled={loading}
                  className="h-7 shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                  <FaSearch size={9} /> {loading ? "Searching…" : "Search"}
                </button>
                <button onClick={runSearch} disabled={loading} title="Refresh"
                  className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                  <FaRedoAlt size={10} />
                </button>

                {/* Show reversed toggle — off by default, reversed txns are noise */}
                <label className="ml-2 shrink-0 inline-flex cursor-pointer items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:border-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={showReversed}
                    onChange={(e) => setShowReversed(e.target.checked)}
                    className="h-3 w-3 cursor-pointer accent-[#0B3B2E]"
                  />
                  Show reversed
                </label>

                <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full bg-[#0B3B2E] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                  <FaShieldAlt size={8} /> Milik Admin
                </span>
              </div>
            </div>

            {/* ── Table card ── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

              {/* History tab */}
              {activeTab === "history" ? (
                <>
                  {histLoading ? (
                    <div className="flex flex-1 items-center justify-center p-12">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0B3B2E] border-t-transparent" />
                    </div>
                  ) : history.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center p-12 text-center">
                      <div><FaHistory className="mx-auto mb-3 text-slate-300" size={32} /><p className="text-sm text-slate-500">No adjustments recorded yet</p></div>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-auto">
                      <table className="w-full text-[11px] border-collapse">
                        <thead className="sticky top-0 z-10 shadow-sm">
                          <tr className="bg-[#0B3B2E] text-white">
                            <th className="px-2 py-1.5 text-left font-bold border-r border-white/10 whitespace-nowrap">Date</th>
                            <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Admin</th>
                            <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Action</th>
                            <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Reference</th>
                            <th className="px-2 py-1.5 text-left font-bold">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((h, i) => (
                            <tr key={h._id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                              <td className="px-2 py-1 text-[11px] text-slate-500">{fmtDate(h.createdAt)}</td>
                              <td className="px-2 py-1 text-[11px] font-semibold text-slate-800">
                                {h.actor?.firstName ? `${h.actor.firstName} ${h.actor.lastName || ""}`.trim() : h.actor?.username || "-"}
                              </td>
                              <td className="px-2 py-1">
                                <span className={`inline-block rounded-full px-1.5 py-px text-[9px] font-bold ${h.action === "booking_date_adjusted" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-blue-50 text-blue-700 border border-blue-200"}`}>
                                  {h.action === "booking_date_adjusted" ? "Date Adjusted" : "Reallocated"}
                                </span>
                              </td>
                              <td className="px-2 py-1 text-[11px] font-mono text-slate-700">{h.targetName || "-"}</td>
                              <td className="px-2 py-1 text-[11px] text-slate-500 max-w-xs truncate" title={h.metadata?.reason}>{h.metadata?.reason || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                      <span className="font-semibold">{histTotal} adjustment{histTotal !== 1 ? "s" : ""} total</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => loadHistory(histPage - 1)} disabled={histPage <= 1}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                          <FaChevronLeft size={9} /> Previous
                        </button>
                        <span className="font-semibold text-slate-700">Page {histPage} of {histTotalPages}</span>
                        <button onClick={() => loadHistory(histPage + 1)} disabled={histPage >= histTotalPages}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                          Next <FaChevronRight size={9} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : !searched && !loading ? (
                <div className="flex flex-1 items-center justify-center p-12 text-center">
                  <div>
                    <FaSearch className="mx-auto mb-3 text-slate-300" size={36} />
                    <p className="text-sm font-bold text-slate-500">Search for transactions to adjust</p>
                    <p className="mt-1 text-xs text-slate-400">Select a property, pick a tenant, or enter a ref number and date range</p>
                  </div>
                </div>
              ) : loading ? (
                <div className="flex flex-1 items-center justify-center p-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0B3B2E] border-t-transparent" />
                </div>
              ) : ledgerRows.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-12 text-center">
                  <div>
                    <FaInfoCircle className="mx-auto mb-3 text-slate-300" size={32} />
                    <p className="text-sm font-bold text-slate-500">No transactions found</p>
                    <p className="mt-1 text-xs text-slate-400">Try adjusting your search criteria</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full min-w-[1100px] text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10 shadow-sm">
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-2 py-1.5 text-left font-bold border-r border-white/10 w-24">Type</th>
                        <th className="px-2 py-1.5 text-center font-bold border-r border-white/10 w-20 whitespace-nowrap">Period</th>
                        <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Tenant · Unit</th>
                        <th className="px-2 py-1.5 text-left font-bold border-r border-white/10">Narration</th>
                        <th className="px-2 py-1.5 text-left font-bold border-r border-white/10 whitespace-nowrap">Txn No</th>
                        <th className="px-2 py-1.5 text-left font-bold border-r border-white/10 whitespace-nowrap">Ref No</th>
                        <th className="px-2 py-1.5 text-center font-bold border-r border-white/10 whitespace-nowrap">Txn Date</th>
                        <th className="px-2 py-1.5 text-center font-bold border-r border-white/10 whitespace-nowrap">Banking Date</th>
                        <th className="px-2 py-1.5 text-right font-bold border-r border-white/10 w-28">Billed</th>
                        <th className="px-2 py-1.5 text-right font-bold border-r border-white/10 w-28">Paid</th>
                        <th className="px-2 py-1.5 text-center font-bold border-r border-white/10 w-24">Status</th>
                        <th className="px-2 py-1.5 text-center font-bold w-28">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedRows.map((row, i) => {
                        const tx   = row._tx;
                        const isPaid = row._kind === "paid";
                        const isBill = row._kind === "bill";
                        const hasOverride = row.bankingDate && toInput(row.bankingDate) !== toInput(row.txDate);
                        const catLabel = CAT_LABEL[row.category] || row.category || (row.isUnapplied ? "Unapplied" : isPaid ? "Payment" : "—");
                        const badgeCls = CAT_BADGE[row.category] || (row.isUnapplied ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600");
                        const isReversed = row.status === "reversed";
                        const rowBg = isReversed
                          ? "bg-slate-50/80 opacity-60"
                          : isPaid
                          ? (i % 2 === 0 ? "bg-emerald-50/30 hover:bg-emerald-50/60" : "bg-emerald-50/50 hover:bg-emerald-50/70")
                          : (i % 2 === 0 ? "bg-white hover:bg-slate-50/80" : "bg-slate-50/40 hover:bg-slate-50/80");
                        return (
                          <tr key={row._rowKey} className={`border-b border-slate-100 transition-colors ${rowBg}`}>
                        {/* ── Type ── */}
                        <td className={`px-2 py-1.5 border-r border-slate-100 ${isPaid ? "border-l-2 border-l-emerald-400" : "border-l-2 border-l-transparent"}`}>
                          <span className={`inline-block rounded px-1.5 py-px text-[10px] font-bold leading-tight ${badgeCls}`}>
                            {catLabel}
                          </span>
                          {isPaid && (
                            <p className="mt-0.5 text-[9px] font-semibold text-emerald-600 leading-none">Paid</p>
                          )}
                          {!isPaid && row._kind === "credit" && (
                            <p className="mt-0.5 text-[9px] font-semibold text-teal-600 leading-none">Credit</p>
                          )}
                        </td>

                        {/* ── Period ── */}
                        <td className="px-2 py-1 border-r border-slate-100 text-center">
                          <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">{fmtPeriod(row.period)}</span>
                        </td>

                        {/* ── Tenant · Unit ── */}
                        <td className="px-2 py-1 border-r border-slate-100">
                          <p className="text-[11px] font-semibold text-slate-900 leading-tight">{tx.tenantName}</p>
                          <p className="text-[10px] text-slate-400 leading-tight">
                            {tx.unitNumber}{tx.propertyName && tx.propertyName !== "-" ? ` · ${tx.propertyName}` : ""}
                          </p>
                        </td>

                        {/* ── Narration ── */}
                        <td className="px-2 py-1 border-r border-slate-100 max-w-[180px]">
                          <p className="text-[11px] text-slate-700 truncate" title={row.narration}>{row.narration || "—"}</p>
                          {isBill && row.taxAmount > 0 && (
                            <p className="text-[9px] text-blue-500 font-semibold leading-tight">
                              VAT {row.taxRate}% · Ksh {fmtKES(row.taxAmount)}
                            </p>
                          )}
                        </td>

                        {/* ── Txn No (receipt # for paid, invoice # for bill) ── */}
                        <td className="px-2 py-1 border-r border-slate-100">
                          <p className="font-mono font-bold text-[10px] text-slate-800 whitespace-nowrap">
                            {isPaid ? (row.txnNo || "—") : (row.invoiceNumber || "—")}
                          </p>
                          {isPaid && row.invoiceNumber && (
                            <p className="text-[9px] text-slate-400 font-mono whitespace-nowrap">Inv: {row.invoiceNumber}</p>
                          )}
                        </td>

                        {/* ── Ref No (bank / mpesa ref) ── */}
                        <td className="px-2 py-1 border-r border-slate-100 max-w-[110px]">
                          <p className="font-mono text-[10px] text-slate-500 truncate" title={row.refAlt || ""}>{row.refAlt || "—"}</p>
                        </td>

                        {/* ── Txn Date ── */}
                        <td className="px-2 py-1 border-r border-slate-100 text-center text-[11px] text-slate-500 whitespace-nowrap">
                          {fmtDate(row.txDate)}
                        </td>

                        {/* ── Banking / Booking Date ── */}
                        <td className="px-2 py-1 border-r border-slate-100 text-center whitespace-nowrap">
                          {hasOverride
                            ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-px text-[9px] font-bold text-amber-700 border border-amber-200">⚡ {fmtDate(row.bankingDate)}</span>
                            : <span className="text-[11px] text-slate-500">{fmtDate(row.bankingDate || row.txDate)}</span>}
                        </td>

                        {/* ── Billed ── */}
                        <td className="px-2 py-1 border-r border-slate-100 text-right">
                          {row.bill > 0 ? (
                            <div>
                              <p className={`font-bold text-[12px] ${isReversed ? "line-through text-slate-400" : "text-slate-900"}`}>
                                {fmtKES(row.bill)}
                              </p>
                              {row.outstanding != null && row.outstanding > 0 && row.outstanding < row.bill && (
                                <p className="text-[9px] font-semibold text-orange-500 leading-tight">Due: {fmtKES(row.outstanding)}</p>
                              )}
                              {row.outstanding === 0 && (
                                <p className="text-[9px] font-semibold text-emerald-500 leading-tight">Settled ✓</p>
                              )}
                              {row.outstanding != null && row.outstanding >= row.bill && (
                                <p className="text-[9px] font-semibold text-rose-500 leading-tight">Unpaid</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-200 text-[12px]">—</span>
                          )}
                        </td>

                        {/* ── Paid ── */}
                        <td className="px-2 py-1 border-r border-slate-100 text-right">
                          {row.paid > 0 ? (
                            <p className={`font-bold text-[12px] ${isReversed ? "line-through text-slate-400" : "text-emerald-600"}`}>
                              {fmtKES(row.paid)}
                            </p>
                          ) : (
                            <span className="text-slate-200 text-[12px]">—</span>
                          )}
                        </td>

                        {/* ── Status ── */}
                        <td className="px-2 py-1 border-r border-slate-100 text-center">
                          <span className={`inline-block rounded-full px-1.5 py-px text-[9px] font-bold capitalize ${STATUS_CLS[row.status] || "bg-slate-50 text-slate-600 border border-slate-200"}`}>
                            {(row.status || "").replace(/_/g, " ")}
                          </span>
                        </td>

                        {/* ── Actions ── */}
                        <td className="px-2 py-1 text-center">
                          <div className="inline-flex items-center gap-1">
                            {!["cancelled", "reversed", "void"].includes(tx.status) && (
                              <button onClick={() => openDatePanel(tx)}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-px text-[9px] font-bold text-slate-700 hover:border-[#0B3B2E] hover:text-[#0B3B2E] transition"
                                title={isPaid ? "Adjust receipt booking date / narration — moves this receipt to a different period" : "Edit booking date or narration"}>
                                <FaCalendarAlt size={7} /> {isPaid ? "Edit Date" : "Edit"}
                              </button>
                            )}
                            {isPaid && row._isFirst && !["cancelled", "reversed"].includes(tx.status) && (
                              <button onClick={() => openReallocPanel(tx)}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-px text-[9px] font-bold text-slate-700 hover:border-[#0B3B2E] hover:text-[#0B3B2E] transition"
                                title="Reallocate this receipt">
                                <FaExchangeAlt size={7} /> Realloc
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* ── Totals row ── */}
                  {paginatedRows.length > 0 && (
                    <tr className="bg-[#0B3B2E]/5 border-t-2 border-[#0B3B2E]/20">
                      <td colSpan={8} className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-wider text-[#0B3B2E]/70">
                        {ledgerRows.length > ITEMS_PER_PAGE ? "Page Totals" : "Totals"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <p className="font-black text-[12px] text-slate-900">{fmtKES(ledgerTotals.bill)}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Billed</p>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <p className="font-black text-[12px] text-emerald-700">{fmtKES(ledgerTotals.paid)}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Paid</p>
                      </td>
                      <td colSpan={2} className="px-3 py-2">
                        {ledgerTotals.bill > 0 && (
                          <div className="text-center">
                            <p className={`font-black text-[12px] ${ledgerTotals.bill > ledgerTotals.paid ? "text-rose-600" : "text-emerald-600"}`}>
                              {fmtKES(Math.abs(round2(ledgerTotals.bill - ledgerTotals.paid)))}
                            </p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                              {ledgerTotals.bill > ledgerTotals.paid ? "Outstanding" : ledgerTotals.paid > ledgerTotals.bill ? "Overpaid" : "Settled"}
                            </p>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab !== "history" && searched && !loading && ledgerRows.length > 0 && (
                <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                    <div className="font-semibold">
                      Showing <span className="font-bold text-slate-900">{ledgerRows.length === 0 ? 0 : startIdx + 1}</span> to{" "}
                      <span className="font-bold text-slate-900">{Math.min(endIdx, ledgerRows.length)}</span> of{" "}
                      <span className="font-bold text-slate-900">{ledgerRows.length}</span> ledger entries
                      <span className="text-slate-400 ml-2">({displayResults.length} transactions)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                      <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                        <FaChevronLeft size={9} /> Previous
                      </button>
                      <span className="font-semibold text-slate-700">Page {safePage} of {totalPages}</span>
                      <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                        Next <FaChevronRight size={9} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>

      {/* ── EDIT TRANSACTION PANEL (date + narration) ──────────────────────── */}
      <SidePanel open={!!datePanel} onClose={closeDatePanel}
        title="Edit Transaction"
        subtitle={datePanel ? `${(datePanel.type || "").replace(/_/g, " ")} · ${datePanel.refNumber}` : ""}>
        {datePanel && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {[["Tenant", datePanel.tenantName], ["Unit", datePanel.unitNumber], ["Amount", `Ksh ${fmtKES(datePanel.amount)}`], ["Status", datePanel.status]].map(([l, v]) => (
                  <div key={l}><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{l}</p><p className="mt-0.5 font-bold text-slate-800 capitalize">{v || "-"}</p></div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current</p>
                <p className="mt-1 text-sm font-bold text-slate-800">{fmtDate(datePanel.bookingDate || datePanel.transactionDate)}</p>
                {origPeriod && <p className="mt-0.5 text-xs text-slate-500">Period: <strong>{origPeriod}</strong></p>}
              </div>
              <div className="rounded-lg border border-[#0B3B2E]/20 bg-[#0B3B2E]/5 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0B3B2E]/60">New</p>
                <p className="mt-1 text-sm font-bold text-[#0B3B2E]">{newBookDate ? fmtDate(newBookDate) : "—"}</p>
                {periodLabel && <p className="mt-0.5 text-xs text-[#0B3B2E]/70">Period: <strong>{periodLabel}</strong></p>}
              </div>
            </div>

            {datePanel.type === "meter_reading" && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                <FaInfoCircle className="mt-0.5 shrink-0" size={11} />
                <p>For meter readings, the linked invoice ({datePanel.linkedInvoiceNumber || "linked"}) booking date will be adjusted.</p>
              </div>
            )}
            {datePanel.type === "payment" && (
              <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                <FaInfoCircle className="mt-0.5 shrink-0" size={11} />
                <p>Changing the booking date moves this receipt <strong>{datePanel.refNumber}</strong> to a different financial period. The original transaction date stays unchanged.</p>
              </div>
            )}

            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Booking Date</label>
              <input type="date" value={newBookDate} onChange={(e) => setNewBookDate(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              <p className="mt-1 text-[10px] text-slate-400">Leave unchanged to keep current date</p>
            </div>

            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Narration</label>
              {datePanel?.description && (
                <p className="mb-1 text-[10px] text-slate-400">Current: <span className="font-medium text-slate-600">{datePanel.description}</span></p>
              )}
              <textarea rows={2} value={newNarration} onChange={(e) => setNewNarration(e.target.value)}
                placeholder="e.g. Rent for Jun/2026 — corrected narration"
                className="w-full resize-none rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
            </div>

            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Reason for change <span className="text-red-500">*</span></label>
              <textarea rows={2} value={dateReason} onChange={(e) => setDateReason(e.target.value)}
                placeholder="e.g. PM requested move to June statement…"
                className="w-full resize-none rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
            </div>
            <div className="flex gap-2">
              <button onClick={closeDatePanel} className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={saveDateShift} disabled={dateSaving || !dateReason.trim()}
                className="flex-1 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {dateSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </SidePanel>

      {/* ── REALLOCATION PANEL ───────────────────────────────────────────────── */}
      <SidePanel open={!!reallocPanel} onClose={closeReallocPanel} wide
        title="Reallocate Payment"
        subtitle={reallocPanel ? `${reallocPanel.refNumber} · Ksh ${fmtKES(reallocPanel?.amount)}` : ""}>
        {reallocPanel && (
          <div className="flex h-full flex-col">
            {/* Summary bar */}
            <div className="flex-none border-b border-slate-100 bg-slate-50 px-5 py-3">
              <div className="flex items-center gap-4 text-xs">
                {[["Tenant", reallocPanel.tenantName], ["Total Paid", `Ksh ${fmtKES(reallocPanel.amount)}`], ["Date", fmtDate(reallocPanel.transactionDate)]].map(([l, v]) => (
                  <div key={l}><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{l}</p><p className="mt-0.5 font-bold text-slate-800">{v}</p></div>
                ))}
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Current allocation rows */}
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-700">Allocation Breakdown</p>
                <div className="space-y-1.5">
                  {reallocRows.length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
                      No allocations yet — add invoices below
                    </p>
                  )}
                  {reallocRows.map((row, idx) => {
                    const isDeposit = row.category === "DEPOSIT_CHARGE";
                    // For already-paid invoices (outstanding = 0 in the original allocation),
                    // show the previously applied amount rather than "Outstanding: Ksh 0"
                    const outstandingLabel = row.invoiceId && row.outstanding != null
                      ? row.outstanding === 0
                        ? `Previously applied: Ksh ${fmtKES(row.amount)}`
                        : `Outstanding: Ksh ${fmtKES(row.outstanding)}`
                      : null;
                    return (
                      <div key={idx} className={`rounded-lg border px-3 py-2 text-xs ${isDeposit ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="truncate font-bold text-slate-800">{row.invoiceNumber || "Unapplied"}</p>
                            {row.description && (
                              <p className="truncate text-[10px] font-medium text-slate-600 mt-px">{row.description}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-slate-400">{CAT_LABEL[row.category] || row.category || "—"}</span>
                              {row.invoiceDate && <span className="text-[10px] text-slate-400">· {fmtDate(row.invoiceDate)}</span>}
                              {outstandingLabel && <span className="text-[10px] text-slate-400">· {outstandingLabel}</span>}
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-400 shrink-0">Ksh</span>
                          <input type="number" min="0" step="0.01" value={row.amount}
                            onChange={(e) => updateRow(idx, e.target.value)}
                            className="w-28 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                          <button onClick={() => removeRow(idx)} className="text-slate-400 hover:text-red-500 shrink-0"><FaTimes size={11} /></button>
                        </div>
                        {isDeposit && (
                          <p className="mt-1 text-[9px] font-semibold text-amber-700 leading-tight">
                            ⚠ Deposit allocations are tracked separately — this will not appear in the landlord statement rent/utility columns.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Running total + balance bar */}
                <div className={`mt-2 flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${reallocValid ? "border-emerald-200 bg-emerald-50" : remaining > 0 ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                  <span className={`font-bold ${reallocValid ? "text-emerald-700" : remaining > 0 ? "text-amber-700" : "text-red-600"}`}>
                    {reallocValid
                      ? <span className="flex items-center gap-1"><FaCheck size={9} /> Total matches payment</span>
                      : remaining > 0
                      ? `Ksh ${fmtKES(remaining)} still unallocated`
                      : `Over-allocated by Ksh ${fmtKES(Math.abs(reallocDiff))}`}
                  </span>
                  <span className="font-black text-slate-700">Ksh {fmtKES(reallocTotal)} / {fmtKES(reallocAmt)}</span>
                </div>

                <button onClick={() => setReallocRows((r) => [...r, { invoiceId: null, invoiceNumber: "", category: "OTHER_CHARGE", outstanding: null, invoiceDate: null, amount: round2(Math.max(0, remaining)) }])}
                  className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 underline hover:text-[#0B3B2E]">
                  <FaPlus size={8} /> Add unapplied / custom row
                </button>
              </div>

              {/* Open invoices picker */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <p className="text-xs font-black uppercase tracking-wider text-slate-700">
                    Open Invoices
                    {invLoading && <span className="ml-1 text-[10px] font-normal normal-case text-slate-400">Loading…</span>}
                    {!invLoading && <span className="ml-1 text-[10px] font-normal normal-case text-slate-500">({filteredAvailInvoices.length})</span>}
                  </p>
                  {remaining > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                      Ksh {fmtKES(remaining)} to allocate
                    </span>
                  )}
                </div>

                {/* Filter for invoices */}
                {availInvoices.length > 3 && (
                  <div className="relative mb-2">
                    <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                    <input type="text" placeholder="Filter by invoice number or category…" value={invFilter}
                      onChange={(e) => setInvFilter(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white py-1.5 pl-6 pr-3 text-xs text-slate-700 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                  </div>
                )}

                {!invLoading && filteredAvailInvoices.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
                    {availInvoices.length === 0 ? "No open invoices for this tenant" : "No invoices match the filter"}
                  </p>
                )}

                {!invLoading && filteredAvailInvoices.length > 0 && (
                  <div className="rounded-lg border border-slate-200 text-xs overflow-hidden">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <span>Invoice</span>
                      <span>Date</span>
                      <span className="text-right">Outstanding</span>
                      <span></span>
                    </div>
                    {filteredAvailInvoices.map((inv) => {
                      const already = reallocRows.some((r) => r.invoiceId === String(inv._id));
                      const rem = round2(reallocAmt - reallocTotal);
                      const maxApplicable = inv._currentlyAllocated ? Number(inv.amount || 0) : Number(inv.outstanding || 0);
                      const smartAmt = round2(Math.min(maxApplicable, Math.max(0, rem)));
                      const isDeposit = inv.category === "DEPOSIT_CHARGE";
                      const noOutstanding = !inv._currentlyAllocated && maxApplicable <= 0;
                      return (
                        <div key={inv._id}
                          className={`border-b border-slate-100 px-3 py-2 last:border-0 ${already ? "bg-slate-50/60 opacity-50" : isDeposit ? "bg-amber-50/50 hover:bg-amber-50" : "bg-white hover:bg-slate-50"}`}>
                          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                            <div className="min-w-0">
                              <p className="truncate font-bold text-slate-800">{inv.invoiceNumber}</p>
                              {inv.description && (
                                <p className="truncate text-[10px] font-medium text-slate-600">{inv.description}</p>
                              )}
                              <div className="flex items-center gap-1 mt-px">
                                <p className="text-[10px] text-slate-400">{CAT_LABEL[inv.category] || inv.category}</p>
                                {inv._currentlyAllocated && <span className="text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded px-1 leading-tight">Currently allocated</span>}
                                {noOutstanding && <span className="text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded px-1 leading-tight">Balance unclear — run Repair</span>}
                              </div>
                            </div>
                            <span className="shrink-0 text-[10px] text-slate-400">{fmtDate(inv.invoiceDate)}</span>
                            <span className={`shrink-0 font-bold ${inv._currentlyAllocated ? "text-blue-600" : noOutstanding ? "text-rose-500" : "text-slate-700"}`}>
                              {inv._currentlyAllocated
                                ? `Ksh ${fmtKES(inv.amount)}`
                                : `Ksh ${fmtKES(inv.outstanding)}`}
                            </span>
                            <button
                              disabled={already || noOutstanding}
                              onClick={() => !already && !noOutstanding && addInvoice(inv)}
                              title={already ? "Already in allocation" : noOutstanding ? "Invoice has no outstanding balance" : `Add — auto-fills Ksh ${fmtKES(smartAmt)}`}
                              className={`shrink-0 inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold transition
                                ${already || noOutstanding
                                  ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                                  : "border-[#0B3B2E]/30 bg-[#0B3B2E]/5 text-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"}`}>
                              {already ? <FaCheck size={8} /> : <FaPlus size={8} />}
                              {already ? "Added" : "Add"}
                            </button>
                          </div>
                          {isDeposit && !already && (
                            <p className="mt-0.5 text-[9px] font-semibold text-amber-700 leading-tight">
                              ⚠ Deposit — tracked separately, not in statement rent/utility columns
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Reason + actions footer */}
            <div className="flex-none border-t border-slate-200 bg-white p-5 space-y-3">
              <div>
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Reason for reallocation <span className="text-red-500">*</span></label>
                <textarea rows={2} value={reallocReason} onChange={(e) => setReallocReason(e.target.value)}
                  placeholder="e.g. PM requested allocation to June rent invoice instead of deposit"
                  className="w-full resize-none rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </div>
              <div className="flex gap-2">
                <button onClick={closeReallocPanel} className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button onClick={saveRealloc} disabled={reallocSaving || !reallocValid || !reallocReason.trim()}
                  className="flex-1 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                  {reallocSaving ? "Saving…" : "Save Reallocation"}
                </button>
              </div>
            </div>
          </div>
        )}
      </SidePanel>
    </>
  );
}
