import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaCalendarAlt, FaChartPie, FaCheck, FaChevronDown, FaChevronRight, FaEdit, FaPlus, FaSearch, FaSyncAlt, FaTimes, FaTrash,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import {
  getBudgets, getBudget, createBudget, updateBudget,
  deleteBudget,
} from "../../redux/apiCalls";
import { getCachedChartOfAccounts } from "../../utils/chartOfAccountsCache";
import AppSelect from "../../components/common/AppSelect";
import CurrencyInput from "../../components/common/CurrencyInput";
import Modal from "../../components/common/Modal";
import { fmtDate } from "../../utils/dates";
import { useConfirm } from "../../context/ConfirmContext";

const fmt  = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const monthLabel = (ym) => {
  const [y, m] = String(ym || "").split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-KE", { month: "short", year: "2-digit" });
};

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const tableInputClass = "h-7 w-full border bg-white px-2 text-xs text-slate-900 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const Section = ({ title, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const VIEW = { LIST: "list", DETAIL: "detail" };

const TYPE_ORDER = ["income", "expense", "asset", "liability", "equity"];
const TYPE_LABEL = { income: "Income", expense: "Expense", asset: "Asset", liability: "Liability", equity: "Equity" };

const statusPill = (status) => {
  const map = { draft: "bg-slate-100 text-slate-500", active: "bg-blue-50 text-blue-700", closed: "bg-emerald-50 text-emerald-700" };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${map[status] || "bg-slate-100 text-slate-400"}`}>
      {status}
    </span>
  );
};

const varianceColor = (accountType, variance) => {
  if (Math.abs(variance) < 0.005) return "text-slate-400";
  const isIncome = accountType === "income";
  const favorable = isIncome ? variance < 0 : variance > 0; // under-budget expense OR over-budget income = favorable
  return favorable ? "text-emerald-600" : "text-red-600";
};

// ─────────────────────────────────────────────────────────────────────────────
const BudgetVsActual = () => {
  const confirm     = useConfirm();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId  = currentCompany?._id;
  const { pathname } = useLocation();
  const isAnalysisRoute = pathname === "/accounts/budget/analysis";

  // Keyed by the actual pathname (not a hardcoded literal) so the "Budget Plans" tab
  // (/accounts/budget) and the "Budget vs Actual" tab (/accounts/budget/analysis) — both
  // rendered by this same component — get independent view state instead of bleeding
  // into each other on every tab switch.
  const [view,       setView]       = useTabState(`${pathname}:view`, VIEW.LIST);
  const [budgets,    setBudgets]    = useState([]);
  const [accounts,   setAccounts]   = useState([]);

  // ── List filters ─────────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [yearFilter,   setYearFilter]   = useState("");
  const [activeBudget, setActiveBudget] = useTabState(`${pathname}:activeBudget`, null);
  const [loadingList,  setLoadingList]  = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ── New budget form ──────────────────────────────────────────────────────────
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName,     setNewName]     = useState("");
  const [newStart,    setNewStart]    = useState("");
  const [newEnd,      setNewEnd]      = useState("");
  const [newNotes,    setNewNotes]    = useState("");
  const [creating,    setCreating]    = useState(false);

  // ── Budget line editor ───────────────────────────────────────────────────────
  const [editingLines, setEditingLines]   = useState(false);
  const [draftLines,   setDraftLines]     = useState([]);
  const [lineSearch,   setLineSearch]     = useState("");
  const [savingLines,  setSavingLines]    = useState(false);
  const [expandedLineIdx, setExpandedLineIdx] = useState(null);

  // ── Variance report: expanded monthly breakdown per line ────────────────────
  const [expandedVarianceLines, setExpandedVarianceLines] = useState(() => new Set());

  // ── Status editor ────────────────────────────────────────────────────────────
  const [savingStatus, setSavingStatus] = useState(false);

  const fetchedRef = useRef(false);

  // ── Load list + accounts ────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    if (!businessId) return;
    setLoadingList(true);
    try {
      const [bList, accts] = await Promise.all([
        getBudgets({ business: businessId }),
        getCachedChartOfAccounts(businessId),
      ]);
      setBudgets(Array.isArray(bList) ? bList : []);
      setAccounts(Array.isArray(accts) ? accts.filter((a) => a.isPosting && !a.isHeader) : []);
    } catch {
      toast.error("Failed to load budgets");
    } finally {
      setLoadingList(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!fetchedRef.current && businessId) { fetchedRef.current = true; loadList(); }
  }, [businessId, loadList]);

  // ── Open budget detail ───────────────────────────────────────────────────────
  const openBudget = useCallback(async (budget) => {
    setLoadingDetail(true);
    try {
      const full = await getBudget(budget._id, { business: businessId });
      setActiveBudget(full);
      setDraftLines((full.lines || []).map((l) => ({ ...l, account: String(l.account) })));
      setEditingLines(false);
      setExpandedLineIdx(null);
      setExpandedVarianceLines(new Set());
      setView(VIEW.DETAIL);
    } catch {
      toast.error("Failed to load budget details");
    } finally {
      setLoadingDetail(false);
    }
  }, [businessId]);

  // ── Auto-open analysis: on /analysis route, load first active budget ─────────
  const analysisAutoRef = useRef(false);
  useEffect(() => {
    if (!isAnalysisRoute || analysisAutoRef.current || loadingList) return;
    if (budgets.length === 0) return;
    const active = budgets.find((b) => b.status === "active") || budgets[0];
    if (active && view === VIEW.LIST) {
      analysisAutoRef.current = true;
      openBudget(active);
    }
  }, [isAnalysisRoute, budgets, loadingList, view, openBudget]);

  // Reset auto flag when navigating away from analysis route
  useEffect(() => {
    if (!isAnalysisRoute) analysisAutoRef.current = false;
  }, [isAnalysisRoute]);

  // ── Create budget ────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return toast.error("Budget name is required");
    if (!newStart || !newEnd) return toast.error("Select period start and end");
    setCreating(true);
    try {
      const b = await createBudget({ business: businessId, name: newName.trim(), periodStart: newStart, periodEnd: newEnd, notes: newNotes });
      toast.success("Budget created");
      setShowNewForm(false);
      setNewName(""); setNewStart(""); setNewEnd(""); setNewNotes("");
      fetchedRef.current = false;
      await loadList();
      await openBudget(b);
    } catch {
      toast.error("Failed to create budget");
    } finally {
      setCreating(false);
    }
  }, [businessId, newName, newStart, newEnd, newNotes, loadList, openBudget]);

  // ── Delete budget ────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (id, e) => {
    e.stopPropagation();
    if (!(await confirm({ title: 'Delete Budget', message: 'Delete this draft budget?', confirmText: 'Delete', isDangerous: true }))) return;
    try {
      await deleteBudget(id, { business: businessId });
      setBudgets((p) => p.filter((b) => b._id !== id));
      toast.success("Budget deleted");
    } catch {
      toast.error("Failed to delete");
    }
  }, [businessId]);

  // ── Save lines ───────────────────────────────────────────────────────────────
  // Only lines with a non-zero budgeted amount are sent — the grid shows every account so
  // you can type into any of them, but a line nobody budgeted anything against isn't worth
  // persisting (and "clearing" a line is just zeroing its amount, not a separate delete step).
  const handleSaveLines = useCallback(async () => {
    if (!activeBudget) return;
    setSavingLines(true);
    try {
      const linesToSave = draftLines.filter((l) => Number(l.budgetedAmount) > 0);
      await updateBudget(activeBudget._id, { business: businessId, lines: linesToSave });
      const full = await getBudget(activeBudget._id, { business: businessId });
      setActiveBudget(full);
      setDraftLines((full.lines || []).map((l) => ({ ...l, account: String(l.account) })));
      setEditingLines(false);
      toast.success("Budget lines saved");
      fetchedRef.current = false;
      loadList();
    } catch {
      toast.error("Failed to save lines");
    } finally {
      setSavingLines(false);
    }
  }, [activeBudget, businessId, draftLines, loadList]);

  // ── Status change ────────────────────────────────────────────────────────────
  const handleStatusChange = useCallback(async (newStatus) => {
    if (!activeBudget) return;
    setSavingStatus(true);
    try {
      await updateBudget(activeBudget._id, { business: businessId, status: newStatus });
      setActiveBudget((p) => ({ ...p, status: newStatus }));
      setBudgets((p) => p.map((b) => b._id === activeBudget._id ? { ...b, status: newStatus } : b));
      toast.success(`Budget marked as ${newStatus}`);
    } catch {
      toast.error("Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  }, [activeBudget, businessId]);

  // ── Back ─────────────────────────────────────────────────────────────────────
  const backToList = () => { setActiveBudget(null); setEditingLines(false); setView(VIEW.LIST); };

  // ── Grouped variance lines ───────────────────────────────────────────────────
  const groupedLines = useMemo(() => {
    if (!activeBudget?.lines) return [];
    const groups = {};
    for (const line of activeBudget.lines) {
      const type = line.accountType || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(line);
    }
    return TYPE_ORDER.filter((t) => groups[t]).map((t) => ({ type: t, lines: groups[t] }));
  }, [activeBudget]);

  const grandTotals = useMemo(() => {
    const lines = activeBudget?.lines || [];
    return {
      budgeted: lines.reduce((s, l) => s + Number(l.budgeted || l.budgetedAmount || 0), 0),
      actual:   lines.reduce((s, l) => s + Number(l.actual || 0), 0),
      variance: lines.reduce((s, l) => s + Number(l.variance || 0), 0),
    };
  }, [activeBudget]);

  // ── Build the full-COA grid: every posting account, pre-filled from the budget's ───
  // existing lines, so editing means typing into any row rather than searching an
  // account picker one at a time (matches QuickBooks' budget entry grid).
  const buildFullGrid = useCallback(() => {
    const existing = new Map((activeBudget?.lines || []).map((l) => [String(l.account), l]));
    return accounts.map((a) => {
      const ex = existing.get(String(a._id));
      return {
        account:        String(a._id),
        accountCode:    a.code || "",
        accountName:    a.name || "",
        accountType:    a.type || "",
        budgetedAmount: ex ? Number(ex.budgetedAmount || 0) : 0,
        monthlyAmounts: ex?.monthlyAmounts?.length ? ex.monthlyAmounts.map((m) => ({ ...m })) : [],
      };
    });
  }, [accounts, activeBudget]);

  const toggleEditLines = () => {
    setEditingLines((p) => {
      const next = !p;
      if (next) { setDraftLines(buildFullGrid()); setExpandedLineIdx(null); setLineSearch(""); }
      return next;
    });
  };

  // ── Months the active budget's period spans, for monthly-spread editing ────
  const periodMonths = useMemo(() => {
    if (!activeBudget?.periodStart || !activeBudget?.periodEnd) return [];
    const start = new Date(activeBudget.periodStart);
    const end = new Date(activeBudget.periodEnd);
    const months = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= last) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [activeBudget]);

  // ── Toggle a line between a flat total and an editable monthly spread ──────
  const toggleMonthlySpread = (idx) => {
    setDraftLines((p) => p.map((l, i) => {
      if (i !== idx) return l;
      if (l.monthlyAmounts?.length) {
        const { monthlyAmounts, ...rest } = l;
        return rest;
      }
      const n = periodMonths.length || 1;
      const even = round2(Number(l.budgetedAmount || 0) / n);
      const monthlyAmounts = periodMonths.map((month, mi) => ({
        month,
        amount: mi === n - 1 ? round2(Number(l.budgetedAmount || 0) - even * (n - 1)) : even,
      }));
      return { ...l, monthlyAmounts };
    }));
    setExpandedLineIdx((p) => (p === idx ? null : idx));
  };

  const updateMonthlyAmount = (idx, month, value) => {
    setDraftLines((p) => p.map((l, i) => {
      if (i !== idx) return l;
      const monthlyAmounts = (l.monthlyAmounts || []).map((m) => (m.month === month ? { ...m, amount: Number(value) || 0 } : m));
      return { ...l, monthlyAmounts, budgetedAmount: round2(monthlyAmounts.reduce((s, m) => s + Number(m.amount || 0), 0)) };
    }));
  };

  const toggleVarianceLine = (key) => {
    setExpandedVarianceLines((p) => {
      const next = new Set(p);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── List filters ─────────────────────────────────────────────────────────────
  const yearOptions = useMemo(() => {
    const years = new Set(budgets.map((b) => new Date(b.periodStart).getFullYear()).filter((y) => !Number.isNaN(y)));
    return Array.from(years).sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
  }, [budgets]);

  const filteredBudgets = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    return budgets.filter((b) => {
      if (q && !b.name?.toLowerCase().includes(q)) return false;
      if (statusFilter && b.status !== statusFilter) return false;
      if (yearFilter && String(new Date(b.periodStart).getFullYear()) !== yearFilter) return false;
      return true;
    });
  }, [budgets, searchInput, statusFilter, yearFilter]);

  const resetFilters = () => { setSearchInput(""); setStatusFilter(""); setYearFilter(""); };

  // ════════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === VIEW.LIST) {
    return (
      <DashboardLayout lockContentScroll>
        <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

          {/* Toolbar */}
          <ListToolbar>
            <FaChartPie size={10} className="text-slate-400" />
            <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
              Budgets: {filteredBudgets.length}
            </span>
            <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
              Active: {filteredBudgets.filter((b) => b.status === "active").length}
            </span>

            <ListToolbar.Divider />

            <div className="relative shrink-0">
              <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
              <ListToolbar.Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search budget name…"
                width="w-44"
                className="pl-6"
              />
            </div>

            <AppSelect
              size="sm"
              clearable
              placeholder="All Statuses"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v ?? "")}
              options={[{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "closed", label: "Closed" }]}
            />

            <AppSelect
              size="sm"
              clearable
              placeholder="All Years"
              value={yearFilter}
              onChange={(v) => setYearFilter(v ?? "")}
              options={yearOptions}
            />

            {(searchInput || statusFilter || yearFilter) && (
              <ListToolbar.Button variant="outline" onClick={resetFilters}>Reset</ListToolbar.Button>
            )}

            <div className="flex-1" />
            <ListToolbar.Button
              variant="outline"
              onClick={() => { fetchedRef.current = false; loadList(); }}
              disabled={loadingList}
            >
              <FaSyncAlt size={7} className={loadingList ? "animate-spin" : ""} />
            </ListToolbar.Button>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPlus} onClick={() => setShowNewForm(true)}>
              New Budget
            </ListToolbar.Button>
          </ListToolbar>

          {/* New budget modal */}
          {showNewForm && (
            <Modal
              title="New Budget"
              icon={<FaChartPie size={12} />}
              onClose={() => setShowNewForm(false)}
              footer={
                <>
                  <button type="button" onClick={() => setShowNewForm(false)}
                    className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    Cancel
                  </button>
                  <button type="submit" form="new-budget-form" disabled={creating}
                    className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                    {creating ? <FaSyncAlt size={10} className="animate-spin" /> : <FaCheck size={10} />}
                    {creating ? "Creating…" : "Create Budget"}
                  </button>
                </>
              }
            >
              <form id="new-budget-form" onSubmit={(e) => { e.preventDefault(); handleCreate(); }} className="space-y-3">
                <div>
                  <label className={labelClass}>Budget Name<Required /></label>
                  <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. FY 2026 Annual" autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Period Start<Required /></label>
                    <input type="date" className={inputClass} value={newStart} onChange={(e) => setNewStart(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Period End<Required /></label>
                    <input type="date" className={inputClass} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Notes</label>
                  <input className={inputClass} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Optional…" />
                </div>
              </form>
            </Modal>
          )}

          {/* List */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <MilikTable
              columns={[
                { label: "Budget Name" },
                { label: "Period" },
                { label: "Status", align: "center" },
                { label: "Lines", align: "right" },
                { label: "Total Budgeted (KES)", align: "right" },
                { label: "Notes" },
              ]}
              rows={filteredBudgets}
              rowKey="_id"
              loading={loadingList && budgets.length === 0}
              empty={budgets.length === 0 ? "No budgets yet. Click “New Budget” to get started." : "No budgets match these filters."}
              onRowClick={openBudget}
              renderActions={(b) => b.status === "draft" && (
                <button onClick={(e) => handleDelete(b._id, e)}
                  className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500">
                  <FaTrash size={10} />
                </button>
              )}
              renderRow={(b) => (
                <>
                  <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{b.name}</td>
                  <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{fmtDate(b.periodStart)} — {fmtDate(b.periodEnd)}</td>
                  <td className="px-3 py-1 border-r border-gray-100 text-center">{statusPill(b.status)}</td>
                  <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-500">{b.lineCount}</td>
                  <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-slate-700">{fmt(b.totalBudgeted)}</td>
                  <td className="max-w-[180px] truncate px-3 py-1 border-r border-gray-100 text-slate-400">{b.notes || "—"}</td>
                </>
              )}
            />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════════════════════════════════════════
  const isLocked = activeBudget?.status === "closed";

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* Toolbar */}
        <ListToolbar>
          <ListToolbar.Button variant="outline" onClick={backToList}>
            ← Back
          </ListToolbar.Button>
          <ListToolbar.Divider />
          <div>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{activeBudget?.name}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="text-[9px] text-slate-500">{fmtDate(activeBudget?.periodStart)} — {fmtDate(activeBudget?.periodEnd)}</span>
            <span className="ml-2">{statusPill(activeBudget?.status)}</span>
          </div>
          <div className="flex-1" />

          {/* Status actions */}
          {!isLocked && activeBudget?.status === "draft" && (
            <ListToolbar.Button
              variant="outline"
              className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
              onClick={() => handleStatusChange("active")}
              disabled={savingStatus}
            >
              Activate
            </ListToolbar.Button>
          )}
          {activeBudget?.status === "active" && (
            <ListToolbar.Button variant="outline" onClick={() => handleStatusChange("closed")} disabled={savingStatus}>
              Close Budget
            </ListToolbar.Button>
          )}

          {!isLocked && (
            <ListToolbar.Button
              variant="outline"
              className={editingLines ? "border-slate-300 bg-slate-100" : ""}
              onClick={toggleEditLines}
            >
              <FaEdit size={7} /> {editingLines ? "Cancel Edit" : "Edit Lines"}
            </ListToolbar.Button>
          )}

          <ListToolbar.Button variant="outline" onClick={() => openBudget(activeBudget)} disabled={loadingDetail}>
            <FaSyncAlt size={7} className={loadingDetail ? "animate-spin" : ""} />
          </ListToolbar.Button>
        </ListToolbar>

        {/* Line editor panel — a full-COA grid: every posting account gets a row, type into */}
        {/* any of them (QuickBooks-style budget entry) instead of adding accounts one at a time. */}
        {editingLines && (
          <div className="shrink-0 max-h-[55vh] overflow-y-auto border-b border-slate-200 bg-slate-50 p-3">
            <Section
              title={`Edit Budget Lines — ${draftLines.filter((l) => Number(l.budgetedAmount) > 0).length} of ${draftLines.length} accounts budgeted`}
            >
              <div className="relative mb-2.5 w-56 shrink-0">
                <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
                <input value={lineSearch} onChange={(e) => setLineSearch(e.target.value)} placeholder="Search accounts…"
                  className={`${inputClass} pl-6`} />
              </div>

              {accounts.length === 0 ? (
                <p className="text-xs text-slate-400">No postable accounts found. Add accounts in Chart of Accounts first.</p>
              ) : (
                <div className="border border-slate-200">
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="w-6 px-1 py-1 border-r border-white/10" />
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Code</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Account</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Budgeted (KES)</th>
                        <th className="w-8 px-1 py-1 font-bold" />
                      </tr>
                    </thead>
                    <tbody>
                      {TYPE_ORDER.filter((t) => draftLines.some((l) => (l.accountType || "other") === t)).map((type) => {
                        const q = lineSearch.trim().toLowerCase();
                        const rows = draftLines
                          .map((line, idx) => ({ line, idx }))
                          .filter(({ line }) => (line.accountType || "other") === type)
                          .filter(({ line }) => !q || line.accountCode.toLowerCase().includes(q) || line.accountName.toLowerCase().includes(q));
                        if (!rows.length) return null;
                        return (
                          <React.Fragment key={type}>
                            <tr className="bg-slate-100/80">
                              <td colSpan={5} className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                {TYPE_LABEL[type] || type}
                              </td>
                            </tr>
                            {rows.map(({ line, idx }) => {
                              const isBudgeted = Number(line.budgetedAmount) > 0;
                              const isSpread = line.monthlyAmounts?.length > 0;
                              const isExpanded = expandedLineIdx === idx;
                              return (
                                <React.Fragment key={line.account}>
                                  <tr className={`border-b border-gray-100 ${isBudgeted ? (idx % 2 === 0 ? "bg-white" : "bg-slate-50/60") : "bg-white opacity-50"} hover:bg-blue-50/30 hover:opacity-100`}>
                                    <td className="px-1 py-1 border-r border-gray-100 text-center">
                                      <button type="button" onClick={() => setExpandedLineIdx((p) => (p === idx ? null : idx))}
                                        className="p-0.5 text-slate-400 hover:text-slate-700">
                                        {isExpanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
                                      </button>
                                    </td>
                                    <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-400">{line.accountCode || "—"}</td>
                                    <td className={`px-3 py-1 border-r border-gray-100 ${isBudgeted ? "font-semibold text-slate-700" : "text-slate-500"}`}>{line.accountName}</td>
                                    <td className="px-3 py-1 border-r border-gray-100 text-right">
                                      {isSpread ? (
                                        <span className="font-mono font-semibold text-slate-700">{fmt(line.budgetedAmount)}</span>
                                      ) : (
                                        <CurrencyInput prefix={null} value={line.budgetedAmount}
                                          onChange={(e) => setDraftLines((p) => p.map((l, i) => i === idx ? { ...l, budgetedAmount: Number(e.target.value) } : l))}
                                          inputClassName={`${tableInputClass} text-right`} />
                                      )}
                                    </td>
                                    <td className="px-1 py-1 text-right">
                                      {(isBudgeted || isSpread) && (
                                        <button type="button" title="Clear this line"
                                          onClick={() => setDraftLines((p) => p.map((l, i) => i === idx ? { ...l, budgetedAmount: 0, monthlyAmounts: [] } : l))}
                                          className="p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><FaTimes size={10} /></button>
                                      )}
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <tr className="border-b border-gray-100 bg-slate-50/80">
                                      <td colSpan={5} className="px-3 py-2">
                                        <div className="mb-1.5 flex items-center justify-between">
                                          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                                            <FaCalendarAlt size={9} /> Monthly Spread
                                          </span>
                                          <button type="button" onClick={() => toggleMonthlySpread(idx)}
                                            className="text-[10px] font-bold text-[#0B3B2E] underline hover:no-underline">
                                            {isSpread ? "Clear spread (use flat total)" : "Spread evenly across period"}
                                          </button>
                                        </div>
                                        {isSpread && (
                                          <div className="flex flex-wrap gap-2">
                                            {line.monthlyAmounts.map((m) => (
                                              <div key={m.month} className="w-24">
                                                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">{monthLabel(m.month)}</label>
                                                <CurrencyInput prefix={null} value={m.amount}
                                                  onChange={(e) => updateMonthlyAmount(idx, m.month, e.target.value)}
                                                  inputClassName={`${tableInputClass} text-right`} />
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <div className="mt-2.5 flex items-center justify-end gap-2">
              <button onClick={() => setEditingLines(false)}
                className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleSaveLines} disabled={savingLines}
                className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                {savingLines ? <FaSyncAlt size={10} className="animate-spin" /> : <FaCheck size={10} />}
                {savingLines ? "Saving…" : "Save Lines"}
              </button>
            </div>
          </div>
        )}

        {/* Variance report */}
        <div className="flex-1 overflow-auto">
          {loadingDetail ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400">
              <FaSyncAlt size={12} className="animate-spin" /> Loading…
            </div>
          ) : !activeBudget?.lines?.length ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-slate-400">
              <p className="text-xs font-semibold">No budget lines yet</p>
              {!isLocked && <p className="text-[11px]">Click "Edit Lines" to add accounts and amounts</p>}
            </div>
          ) : (
            <table className="min-w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="w-6 px-1 py-1 border-r border-white/10" />
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Code</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Account</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Budgeted (KES)</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Actual (KES)</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Variance (KES)</th>
                  <th className="px-3 py-1 text-right font-bold">% Used</th>
                </tr>
              </thead>
              <tbody>
                {groupedLines.map(({ type, lines }) => (
                  <React.Fragment key={type}>
                    {/* Group header */}
                    <tr className="bg-slate-100/80">
                      <td colSpan={7} className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {TYPE_LABEL[type] || type}
                      </td>
                    </tr>
                    {lines.map((line, lineIdx) => {
                      const varColor = varianceColor(line.accountType, line.variance);
                      const pct = line.pctUsed;
                      const hasMonthly = line.monthly?.length > 0;
                      const lineKey = String(line.account);
                      const isExpanded = expandedVarianceLines.has(lineKey);
                      return (
                        <React.Fragment key={lineKey}>
                          <tr className={`border-b border-gray-100 ${lineIdx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                            <td className="px-1 py-1 border-r border-gray-100 text-center">
                              {hasMonthly && (
                                <button type="button" onClick={() => toggleVarianceLine(lineKey)} className="p-0.5 text-slate-400 hover:text-slate-700">
                                  {isExpanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-400">{line.accountCode || "—"}</td>
                            <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{line.accountName}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">{fmt(line.budgeted ?? line.budgetedAmount)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">{fmt(line.actual)}</td>
                            <td className={`px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold ${varColor}`}>
                              {line.variance > 0 ? "+" : ""}{fmt(line.variance)}
                            </td>
                            <td className="px-3 py-1 text-right">
                              {pct !== null ? (
                                <div className="flex items-center justify-end gap-2">
                                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                                    <div
                                      className={`h-full rounded-full ${pct > 100 ? "bg-red-400" : pct > 80 ? "bg-amber-400" : "bg-emerald-400"}`}
                                      style={{ width: `${Math.min(pct, 100)}%` }}
                                    />
                                  </div>
                                  <span className={`w-10 text-right font-mono text-[11px] font-semibold ${pct > 100 ? "text-red-600" : "text-slate-600"}`}>
                                    {pct.toFixed(0)}%
                                  </span>
                                </div>
                              ) : "—"}
                            </td>
                          </tr>
                          {isExpanded && hasMonthly && (
                            <tr className="border-b border-gray-100 bg-slate-50/80">
                              <td colSpan={7} className="px-3 py-2">
                                <div className="overflow-x-auto">
                                  <table className="border-collapse text-[10px]">
                                    <thead>
                                      <tr>
                                        <th className="px-2 py-0.5 text-left font-bold text-slate-500" />
                                        {line.monthly.map((m) => (
                                          <th key={m.month} className="px-2 py-0.5 text-right font-bold text-slate-500">{monthLabel(m.month)}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="px-2 py-0.5 font-semibold text-slate-500">Budgeted</td>
                                        {line.monthly.map((m) => (
                                          <td key={m.month} className="px-2 py-0.5 text-right font-mono text-slate-700">{fmt(m.budgeted)}</td>
                                        ))}
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-0.5 font-semibold text-slate-500">Actual</td>
                                        {line.monthly.map((m) => (
                                          <td key={m.month} className="px-2 py-0.5 text-right font-mono text-slate-700">{fmt(m.actual)}</td>
                                        ))}
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-0.5 font-semibold text-slate-500">Variance</td>
                                        {line.monthly.map((m) => (
                                          <td key={m.month} className={`px-2 py-0.5 text-right font-mono font-semibold ${varianceColor(line.accountType, m.variance)}`}>
                                            {m.variance > 0 ? "+" : ""}{fmt(m.variance)}
                                          </td>
                                        ))}
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {/* Group subtotal */}
                    <tr className="bg-slate-50/40 text-[10px] font-bold text-slate-500">
                      <td colSpan={3} className="px-3 py-1 text-right uppercase tracking-wide">Subtotal</td>
                      <td className="px-3 py-1 text-right font-mono">{fmt(lines.reduce((s, l) => s + Number(l.budgeted ?? l.budgetedAmount ?? 0), 0))}</td>
                      <td className="px-3 py-1 text-right font-mono">{fmt(lines.reduce((s, l) => s + Number(l.actual || 0), 0))}</td>
                      <td className={`px-3 py-1 text-right font-mono ${varianceColor(type, lines.reduce((s, l) => s + Number(l.variance || 0), 0))}`}>
                        {(() => { const v = lines.reduce((s, l) => s + Number(l.variance || 0), 0); return `${v > 0 ? "+" : ""}${fmt(v)}`; })()}
                      </td>
                      <td />
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-[10px] font-black text-slate-600">
                  <td colSpan={3} className="px-4 py-2.5 uppercase tracking-wide">Grand Total</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmt(grandTotals.budgeted)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmt(grandTotals.actual)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono ${Math.abs(grandTotals.variance) < 0.005 ? "text-slate-400" : grandTotals.variance > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {grandTotals.variance > 0 ? "+" : ""}{fmt(grandTotals.variance)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {grandTotals.budgeted > 0 ? `${((grandTotals.actual / grandTotals.budgeted) * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default BudgetVsActual;
