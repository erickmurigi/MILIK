import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaChartPie, FaCheck, FaEdit, FaPlus, FaSyncAlt, FaTimes, FaTrash,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  getBudgets, getBudget, createBudget, updateBudget,
  deleteBudget, getChartOfAccounts,
} from "../../redux/apiCalls";

const GRN = "#0B3B2E";
const fmt  = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const localDate = (d) => { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; };

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
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId  = currentCompany?._id;
  const companyName = String(currentCompany?.companyName || currentCompany?.name || "").trim();
  const { pathname } = useLocation();
  const isAnalysisRoute = pathname === "/accounts/budget/analysis";

  const [view,       setView]       = useTabState("/accounts/budget:view", VIEW.LIST);
  const [budgets,    setBudgets]    = useState([]);
  const [accounts,   setAccounts]   = useState([]);
  const [activeBudget, setActiveBudget] = useTabState("/accounts/budget:activeBudget", null);
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
  const [addAccount,   setAddAccount]     = useState("");
  const [addAmount,    setAddAmount]      = useState("");
  const [savingLines,  setSavingLines]    = useState(false);

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
        getChartOfAccounts({ business: businessId }),
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
    if (!window.confirm("Delete this draft budget?")) return;
    try {
      await deleteBudget(id, { business: businessId });
      setBudgets((p) => p.filter((b) => b._id !== id));
      toast.success("Budget deleted");
    } catch {
      toast.error("Failed to delete");
    }
  }, [businessId]);

  // ── Save lines ───────────────────────────────────────────────────────────────
  const handleSaveLines = useCallback(async () => {
    if (!activeBudget) return;
    setSavingLines(true);
    try {
      await updateBudget(activeBudget._id, { business: businessId, lines: draftLines });
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

  // ── Add line ─────────────────────────────────────────────────────────────────
  const handleAddLine = () => {
    if (!addAccount) return toast.error("Select an account");
    if (Number(addAmount) < 0) return toast.error("Amount must be 0 or more");
    if (draftLines.some((l) => l.account === addAccount)) return toast.error("Account already in budget");
    const acct = accounts.find((a) => a._id === addAccount);
    setDraftLines((p) => [...p, {
      account: addAccount, accountCode: acct?.code || "", accountName: acct?.name || "",
      accountType: acct?.type || "", budgetedAmount: Number(addAmount || 0),
    }]);
    setAddAccount(""); setAddAmount("");
  };

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

  // ── Available accounts for add-line picker ──────────────────────────────────
  const usedIds = useMemo(() => new Set(draftLines.map((l) => l.account)), [draftLines]);
  const availableAccounts = useMemo(() => accounts.filter((a) => !usedIds.has(a._id)), [accounts, usedIds]);

  // ════════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === VIEW.LIST) {
    return (
      <DashboardLayout lockContentScroll>
        <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

          {/* Toolbar */}
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2">
            <FaChartPie size={11} className="text-slate-400" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Budget vs Actual</p>
            <div className="flex-1" />
            <button
              onClick={() => setShowNewForm(true)}
              className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white"
              style={{ backgroundColor: GRN }}
            >
              <FaPlus size={9} /> New Budget
            </button>
            <button
              onClick={() => { fetchedRef.current = false; loadList(); }}
              disabled={loadingList}
              className="flex h-7 items-center rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <FaSyncAlt size={10} className={loadingList ? "animate-spin" : ""} />
            </button>
          </div>

          {/* New budget form */}
          {showNewForm && (
            <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">New Budget</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] font-semibold uppercase text-slate-400">Name *</label>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. FY 2026 Annual"
                    className="h-7 w-52 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] font-semibold uppercase text-slate-400">Period Start *</label>
                  <input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)}
                    className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] font-semibold uppercase text-slate-400">Period End *</label>
                  <input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
                    className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] font-semibold uppercase text-slate-400">Notes</label>
                  <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Optional…"
                    className="h-7 w-40 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                </div>
                <button onClick={handleCreate} disabled={creating}
                  className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: GRN }}>
                  {creating ? <FaSyncAlt size={9} className="animate-spin" /> : <FaCheck size={9} />}
                  {creating ? "Creating…" : "Create"}
                </button>
                <button onClick={() => setShowNewForm(false)}
                  className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                  <FaTimes size={9} /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-auto">
            {loadingList ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400">
                <FaSyncAlt size={12} className="animate-spin" /> Loading…
              </div>
            ) : budgets.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-1 text-slate-400">
                <FaChartPie size={22} className="opacity-20" />
                <p className="text-xs font-semibold">No budgets yet</p>
                <p className="text-[11px]">Click "New Budget" to get started</p>
              </div>
            ) : (
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Budget Name</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Period</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Lines</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Total Budgeted (KES)</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Notes</th>
                    <th className="px-3 py-1 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((b, idx) => (
                    <tr key={b._id} className={`border-b border-gray-100 cursor-pointer ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`} onClick={() => openBudget(b)}>
                      <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{b.name}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{fmtDate(b.periodStart)} — {fmtDate(b.periodEnd)}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-center">{statusPill(b.status)}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-500">{b.lineCount}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-slate-700">{fmt(b.totalBudgeted)}</td>
                      <td className="max-w-[180px] truncate px-3 py-1 border-r border-gray-100 text-slate-400">{b.notes || "—"}</td>
                      <td className="px-3 py-1 text-right">
                        {b.status === "draft" && (
                          <button onClick={(e) => handleDelete(b._id, e)}
                            className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500">
                            <FaTrash size={10} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2">
          <button onClick={backToList}
            className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ← Back
          </button>
          <div className="mx-1 h-4 w-px bg-slate-200" />
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{activeBudget?.name}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="text-[10px] text-slate-500">{fmtDate(activeBudget?.periodStart)} — {fmtDate(activeBudget?.periodEnd)}</span>
            <span className="ml-2">{statusPill(activeBudget?.status)}</span>
          </div>
          <div className="flex-1" />

          {/* Status actions */}
          {!isLocked && activeBudget?.status === "draft" && (
            <button onClick={() => handleStatusChange("active")} disabled={savingStatus}
              className="flex h-7 items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
              Activate
            </button>
          )}
          {activeBudget?.status === "active" && (
            <button onClick={() => handleStatusChange("closed")} disabled={savingStatus}
              className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Close Budget
            </button>
          )}

          {!isLocked && (
            <button onClick={() => setEditingLines((p) => !p)}
              className={`flex h-7 items-center gap-1.5 rounded border px-3 text-xs font-semibold ${editingLines ? "border-slate-300 bg-slate-100 text-slate-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              <FaEdit size={10} /> {editingLines ? "Cancel Edit" : "Edit Lines"}
            </button>
          )}

          <button onClick={() => openBudget(activeBudget)} disabled={loadingDetail}
            className="flex h-7 items-center rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <FaSyncAlt size={10} className={loadingDetail ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Line editor panel */}
        {editingLines && (
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Edit Budget Lines</p>

            {/* Add line row */}
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] font-semibold uppercase text-slate-400">Account</label>
                <select value={addAccount} onChange={(e) => setAddAccount(e.target.value)}
                  className="h-7 min-w-[260px] rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                  <option value="">Select account…</option>
                  {availableAccounts.map((a) => (
                    <option key={a._id} value={a._id}>{a.code ? `${a.code} — ` : ""}{a.name} ({a.type})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] font-semibold uppercase text-slate-400">Budgeted Amount (KES)</label>
                <input type="number" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder="0.00" min="0"
                  className="h-7 w-40 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              </div>
              <button onClick={handleAddLine}
                className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <FaPlus size={9} /> Add Line
              </button>
            </div>

            {/* Draft lines mini table */}
            {draftLines.length > 0 && (
              <div className="mb-3 overflow-x-auto rounded border border-slate-200 bg-white">
                <table className="min-w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Code</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Account</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Budgeted (KES)</th>
                      <th className="px-3 py-1 font-bold" />
                    </tr>
                  </thead>
                  <tbody>
                    {draftLines.map((line, idx) => (
                      <tr key={line.account} className={`border-b border-gray-100 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                        <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-400">{line.accountCode || "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-700">{line.accountName}</td>
                        <td className="px-3 py-1 border-r border-gray-100 capitalize text-slate-500">{line.accountType}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right">
                          <input type="number" value={line.budgetedAmount} min="0"
                            onChange={(e) => setDraftLines((p) => p.map((l, i) => i === idx ? { ...l, budgetedAmount: Number(e.target.value) } : l))}
                            className="h-6 w-32 rounded border border-slate-200 px-2 text-right text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                        </td>
                        <td className="px-3 py-1 text-right">
                          <button onClick={() => setDraftLines((p) => p.filter((_, i) => i !== idx))}
                            className="text-slate-300 hover:text-red-500"><FaTimes size={10} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button onClick={handleSaveLines} disabled={savingLines}
                className="flex h-7 items-center gap-1.5 rounded px-4 text-xs font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: GRN }}>
                {savingLines ? <FaSyncAlt size={9} className="animate-spin" /> : <FaCheck size={9} />}
                {savingLines ? "Saving…" : "Save Lines"}
              </button>
              <button onClick={() => setEditingLines(false)}
                className="flex h-7 items-center rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
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
                      <td colSpan={6} className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {TYPE_LABEL[type] || type}
                      </td>
                    </tr>
                    {lines.map((line, lineIdx) => {
                      const varColor = varianceColor(line.accountType, line.variance);
                      const pct = line.pctUsed;
                      return (
                        <tr key={String(line.account)} className={`border-b border-gray-100 ${lineIdx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
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
                      );
                    })}
                    {/* Group subtotal */}
                    <tr className="bg-slate-50/40 text-[10px] font-bold text-slate-500">
                      <td colSpan={2} className="px-3 py-1 text-right uppercase tracking-wide">Subtotal</td>
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
                  <td colSpan={2} className="px-4 py-2.5 uppercase tracking-wide">Grand Total</td>
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
